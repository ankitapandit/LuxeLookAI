"""
routers/profile.py — User profile endpoints
GET  /profile           — fetch current user's profile
PUT  /profile           — update profile fields
POST /profile/photo     — upload avatar/profile photo
POST /profile/ai-photo  — upload AI profiling photo + analyze styling traits
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
import time
import traceback

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from config import get_settings
from ml.llm import analyze_profile_traits
from models.schemas import (
    AIProfileAnalysis,
    AIProfilePhotoUploadResponse,
    PhotoUploadResponse,
    UpdateProfileRequest,
    UserProfile,
)
from utils.auth import get_current_user_id

ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_IMAGE_TYPES = {"jpeg", "jpg", "png", "webp"}
MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10MB
PROFILE_BUCKET = "profile-photos"
AI_PROFILE_BUCKET = "ai-profile-photos"

router = APIRouter()
TABLE = "users"


def _mock_seed_profile_if_needed(user_id: str) -> dict:
    from utils.mock_auth_store import get_mock_user_profile
    from utils.mock_db_store import insert, select_one

    user = select_one(TABLE, {"id": user_id})
    if user:
        return user

    seed = get_mock_user_profile(user_id)
    if not seed:
        raise HTTPException(status_code=404, detail="Profile not found")
    insert(TABLE, seed)
    return seed


def _get_profile_or_404(user_id: str) -> dict:
    settings = get_settings()
    if settings.use_mock_auth:
        return _mock_seed_profile_if_needed(user_id)

    from utils.db import get_supabase

    result = get_supabase().table(TABLE).select("*").eq("id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Profile not found")
    return result.data


def _update_profile_row(user_id: str, updates: dict) -> dict:
    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import update

        _mock_seed_profile_if_needed(user_id)
        result = update(TABLE, user_id, updates, extra_filters={"id": user_id})
        if not result:
            raise HTTPException(status_code=404, detail="Profile not found")
        return result

    from utils.db import get_supabase

    get_supabase().table(TABLE).update(updates).eq("id", user_id).execute()
    return _get_profile_or_404(user_id)


async def _read_validated_photo(photo: UploadFile) -> tuple[bytes, str, str]:
    mime_type = photo.content_type or "image/jpeg"
    print(f"[profile] validating photo filename={photo.filename!r} mime_type={mime_type!r}")
    if mime_type not in ALLOWED_MIME_TYPES:
        print(f"[profile] rejected photo due to mime_type={mime_type!r}")
        raise HTTPException(status_code=400, detail="Only JPG, PNG and WEBP images are accepted")

    contents = await photo.read()
    print(f"[profile] photo bytes read size={len(contents)}")
    if len(contents) > MAX_SIZE_BYTES:
        print(f"[profile] rejected photo due to size={len(contents)} > {MAX_SIZE_BYTES}")
        raise HTTPException(status_code=400, detail="Image must be under 10MB")

    ext = (photo.filename or "photo").rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_IMAGE_TYPES:
        ext = "jpg"

    return contents, mime_type, ext


def _data_url(contents: bytes, mime_type: str) -> str:
    encoded = base64.b64encode(contents).decode()
    return f"data:{mime_type};base64,{encoded}"


def _delete_existing_user_images(db, bucket: str, user_id: str, prefix: str) -> None:
    try:
        existing = db.storage.from_(bucket).list(path=user_id)
        if not existing:
            return
        paths_to_delete = [
            f"{user_id}/{item['name']}"
            for item in existing
            if item["name"].startswith(f"{prefix}_")
            and item["name"].lower().endswith(tuple(ALLOWED_IMAGE_TYPES))
        ]
        if paths_to_delete:
            db.storage.from_(bucket).remove(paths_to_delete)
    except Exception:
        pass


def _upload_user_image(bucket: str, user_id: str, prefix: str, contents: bytes, ext: str) -> str:
    from utils.db import get_supabase

    db = get_supabase()
    path = f"{user_id}/{prefix}_{int(time.time())}.{ext}"
    print(f"[profile] uploading image bucket={bucket!r} user_id={user_id!r} path={path!r} bytes={len(contents)}")
    _delete_existing_user_images(db, bucket, user_id, prefix)

    try:
        db.storage.from_(bucket).upload(path, contents)
        print(f"[profile] storage upload complete bucket={bucket!r} path={path!r}")
    except Exception as exc:
        print(f"[profile] storage upload failed bucket={bucket!r} path={path!r} error={exc}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {str(exc)}")

    url = db.storage.from_(bucket).get_public_url(path).rstrip("?")
    print(f"[profile] storage public url generated bucket={bucket!r} path={path!r} url={url!r}")
    return url


@router.get("/", response_model=UserProfile)
def get_profile(user_id: str = Depends(get_current_user_id)):
    return _get_profile_or_404(user_id)


@router.put("/", response_model=UserProfile)
def update_profile(payload: UpdateProfileRequest, user_id: str = Depends(get_current_user_id)):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided")
    return _update_profile_row(user_id, updates)


@router.post("/photo", response_model=PhotoUploadResponse)
async def upload_photo(
    photo: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    contents, mime_type, ext = await _read_validated_photo(photo)
    settings = get_settings()

    if settings.use_mock_auth:
        url = _data_url(contents, mime_type)
    else:
        url = _upload_user_image(PROFILE_BUCKET, user_id, "profile", contents, ext)

    _update_profile_row(user_id, {"photo_url": url})
    return {"photo_url": url}


@router.post("/ai-photo", response_model=AIProfilePhotoUploadResponse)
async def upload_ai_profile_photo(
    photo: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    print(f"[profile] /profile/ai-photo start user_id={user_id!r}")
    try:
        contents, mime_type, ext = await _read_validated_photo(photo)
        settings = get_settings()
        analyzed_at = datetime.now(timezone.utc)
        print(
            f"[profile] ai-photo request prepared user_id={user_id!r} "
            f"mime_type={mime_type!r} ext={ext!r} use_mock_auth={settings.use_mock_auth} use_mock_ai={settings.use_mock_ai}"
        )

        raw_analysis = analyze_profile_traits(contents, mime_type)
        print(f"[profile] ai-photo raw analysis={raw_analysis}")
        analysis = AIProfileAnalysis(**raw_analysis)
        print(f"[profile] ai-photo normalized analysis={analysis.model_dump()}")

        if settings.use_mock_auth:
            url = _data_url(contents, mime_type)
            print(f"[profile] ai-photo using mock data url length={len(url)}")
        else:
            url = _upload_user_image(AI_PROFILE_BUCKET, user_id, "ai_profile", contents, ext)

        updates = {
            "ai_profile_photo_url": url,
            "ai_profile_analysis": analysis.model_dump(),
            "ai_profile_analyzed_at": analyzed_at.isoformat(),
        }
        print(f"[profile] ai-photo updating profile row with keys={list(updates.keys())}")
        _update_profile_row(user_id, updates)
        print(f"[profile] /profile/ai-photo success user_id={user_id!r}")
        return {
            "ai_profile_photo_url": url,
            "ai_profile_analysis": analysis.model_dump(),
            "ai_profile_analyzed_at": analyzed_at.isoformat(),
        }
    except Exception as exc:
        print(f"[profile] /profile/ai-photo failed user_id={user_id!r} error={exc}")
        traceback.print_exc()
        raise
