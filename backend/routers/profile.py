"""
routers/profile.py — User profile endpoints
GET  /profile      — fetch current user's profile
PUT  /profile      — update profile fields
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from models.schemas import UserProfile, UpdateProfileRequest
from utils.auth import get_current_user_id
from config import get_settings
from ml.llm import detect_face_shape
import time

ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_IMAGE_TYPES = {"jpeg", "jpg", "png", "webp"}
MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10MB
STORAGE_BUCKET = "profile-photos"

router = APIRouter()
TABLE = "users"

@router.get("/", response_model=UserProfile)
def get_profile(user_id: str = Depends(get_current_user_id)):
    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import select_one
        user = select_one(TABLE, {"id": user_id})
        if not user:
            raise HTTPException(status_code=404, detail="Profile not found")
        return user
    else:
        from utils.db import get_supabase
        result = get_supabase().table(TABLE).select("*").eq("id", user_id).single().execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Profile not found")
        return result.data


@router.put("/", response_model=UserProfile)
def update_profile(payload: UpdateProfileRequest, user_id: str = Depends(get_current_user_id)):
    # Only update fields that were actually provided
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided")

    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import update
        result = update(TABLE, user_id, updates, extra_filters={"id": user_id})
        if not result:
            raise HTTPException(status_code=404, detail="Profile not found")
        return result
    else:
        from utils.db import get_supabase
        result = (
            get_supabase().table(TABLE)
            .update(updates)
            .eq("id", user_id)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Profile not found")
        return result.data[0]

@router.post("/photo")
async def upload_photo(
    photo: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    settings = get_settings()
    if not settings.use_mock_auth:
        # Validate MIME type
        if photo.content_type not in ALLOWED_MIME_TYPES:
            raise HTTPException(status_code=400, detail="Only JPG, PNG and WEBP images are accepted")

        # Read file
        contents = await photo.read()

        # Validate size
        if len(contents) > MAX_SIZE_BYTES:
            raise HTTPException(status_code=400, detail="Image must be under 10MB")

        from utils.db import get_supabase
        import uuid
        db = get_supabase()

        # Upload to profile-photos bucket
        ext = (photo.filename or "photo").rsplit(".", 1)[-1].lower()
        if ext not in ("jpg", "jpeg", "png", "webp"):
            ext = "jpg"
        path = f"{user_id}/profile_{int(time.time())}.{ext}"

        # Delete all existing photos for this user before uploading new one
        try:
            existing = db.storage.from_(STORAGE_BUCKET).list(path=user_id)
            if existing:
                paths_to_delete = [f"{user_id}/{f['name']}" for f in existing if
                                   f['name'].lower().endswith(tuple(ALLOWED_IMAGE_TYPES))]
                db.storage.from_(STORAGE_BUCKET).remove(paths_to_delete)
        except Exception:
            pass

        try:
            db.storage.from_(STORAGE_BUCKET).upload(path, contents)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Storage upload failed: {str(e)}")

        # Get permanent public URL
        url = db.storage.from_(STORAGE_BUCKET).get_public_url(path).rstrip("?")

        # Update photo_url in users table
        db.table("users").update({"photo_url": url}).eq("id", user_id).execute()

        # Detect face shape via GPT-4o Vision (best-effort — never fails the upload)
        face_data = detect_face_shape(contents, photo.content_type or "image/jpeg")

        # Persist face shape if detected with sufficient confidence
        if face_data.get("face_shape"):
            db.table("users").update({"face_shape": face_data["face_shape"]}).eq("id", user_id).execute()

        return {
            "photo_url":       url,
            "face_shape":      face_data.get("face_shape"),
            "face_confidence": face_data.get("confidence"),
            "face_reason":     face_data.get("reason"),
        }
    return None
