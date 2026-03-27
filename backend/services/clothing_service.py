"""
services/clothing_service.py — Wardrobe item CRUD
==================================================
Supports two modes (controlled by USE_MOCK_AUTH in .env):
  - Mock mode  → stores items in memory, images as data-URLs (no Supabase Storage needed)
  - Real mode  → uploads to Supabase Storage, persists to Supabase DB
"""

from __future__ import annotations
import base64
import logging
import uuid
from typing import List, Dict, Any, Optional
from config import get_settings
from ml.tagger import tag_clothing_item
from ml.embeddings import generate_embedding

logger = logging.getLogger(__name__)

TABLE = "clothing_items"
STORAGE_BUCKET = "clothing-images"
DUPLICATE_THRESHOLD = 0.95


# ── Mock implementation ───────────────────────────────────────────────────────

def _upload_mock(user_id: str, image_bytes: bytes, filename: str, manual_tags: Optional[Dict]) -> Dict:
    """
    Store item entirely in memory.
    The image is saved as a base64 data-URL so it can still be displayed
    in the frontend <img> tags without any external storage.
    """
    from utils.mock_db_store import insert

    item_id = str(uuid.uuid4())

    # Detect MIME type from filename extension
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpeg"
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")
    image_url = f"data:{mime};base64,{base64.b64encode(image_bytes).decode()}"

    # Auto-tag + generate embedding using the data-URL as the seed
    tags = tag_clothing_item(image_url, image_bytes)
    if manual_tags:
        tags.update(manual_tags)

    embedding = generate_embedding(image_url, image_bytes)

    row = {
        "id":                item_id,
        "user_id":           user_id,
        "category":          tags["category"],
        "item_type":         tags["item_type"],
        "accessory_subtype": tags.get("accessory_subtype"),
        "color":             tags.get("color"),
        "pattern":           tags.get("pattern"),
        "season":            tags.get("season"),
        "formality_score":   tags.get("formality_score"),
        "image_url":         image_url,
        "embedding_vector":  embedding,
        "descriptors": item.descriptors or {},
    }
    return insert(TABLE, row)


def _get_items_mock(user_id: str) -> List[Dict]:
    from utils.mock_db_store import select_all
    return select_all(TABLE, {"user_id": user_id})


def _delete_item_mock(item_id: str, user_id: str) -> bool:
    from utils.mock_db_store import delete
    return delete(TABLE, item_id, extra_filters={"user_id": user_id})


# ── Real implementation (Supabase) ────────────────────────────────────────────

def _upload_real(user_id: str, image_bytes: bytes, filename: str, manual_tags: Optional[Dict]) -> Dict:
    from utils.db import get_supabase
    db = get_supabase()
    item_id      = str(uuid.uuid4())
    storage_path = f"{user_id}/{item_id}/{filename}"

    db.storage.from_(STORAGE_BUCKET).upload(storage_path, image_bytes)
    image_url = db.storage.from_(STORAGE_BUCKET).get_public_url(storage_path).rstrip("?")

    tags = tag_clothing_item(image_url, image_bytes)
    if manual_tags:
        tags.update(manual_tags)

    embedding = generate_embedding(image_url, image_bytes)
    vec_str = "[" + ",".join(str(x) for x in embedding) + "]"
    row = {
        "id":                item_id,
        "user_id":           user_id,
        "category":          tags["category"],
        "item_type":         tags["item_type"],
        "accessory_subtype": tags.get("accessory_subtype"),
        "color":             tags.get("color"),
        "pattern":           tags.get("pattern"),
        "season":            tags.get("season"),
        "formality_score":   tags.get("formality_score"),
        "image_url":         image_url,
        "embedding_vector": vec_str,
        "descriptors": tags.get("descriptors") or manual_tags.get("descriptors") or {},
    }
    result = db.table(TABLE).insert(row).execute()
    return result.data[0]


def _get_items_real(user_id: str) -> List[Dict]:
    from utils.db import get_supabase
    import json
    db = get_supabase()
    items = db.table(TABLE).select("*, embedding_vector").eq("user_id", user_id).execute().data
    # Parse embedding_vector from string back to list if needed
    for item in items:
        if isinstance(item.get("embedding_vector"), str):
            try:
                item["embedding_vector"] = [float(x) for x in ev.strip("[]").split(",")]
            except Exception:
                item["embedding_vector"] = None
    return items


def _delete_item_real(item_id: str, user_id: str) -> bool:
    from utils.db import get_supabase
    db = get_supabase()
    # result = db.table(TABLE).delete().eq("id", item_id).eq("user_id", user_id).execute()
    # return len(result.data) > 0
    # Fetch image_url before deleting
    item = db.table(TABLE).select("image_url").eq("id", item_id).eq("user_id", user_id).single().execute()
    if not item.data:
        return False
    # Delete from storage
    image_url = item.data.get("image_url", "")
    if image_url:
        try:
            # Extract path from URL — everything after /clothing-images/
            path = image_url.split("/clothing-images/")[-1].split("?")[0]
            db.storage.from_("clothing-images").remove([path])
        except Exception as e:
            print(f"DEBUG storage delete failed: {e}")  # non-blocking
    # Delete from table
    result = db.table(TABLE).delete().eq("id", item_id).eq("user_id", user_id).execute()
    return bool(result.data)


# ── Public interface ──────────────────────────────────────────────────────────

def upload_clothing_item(
    user_id: str,
    image_bytes: bytes,
    filename: str,
    manual_tags: Optional[Dict] = None,
) -> Dict[str, Any]:
    """Upload, tag, embed and persist a clothing item."""
    settings = get_settings()
    if settings.use_mock_auth:
        return _upload_mock(user_id, image_bytes, filename, manual_tags)
    return _upload_real(user_id, image_bytes, filename, manual_tags)


def get_user_items(user_id: str) -> List[Dict[str, Any]]:
    """Fetch all clothing items belonging to a user."""
    settings = get_settings()
    if settings.use_mock_auth:
        return _get_items_mock(user_id)
    return _get_items_real(user_id)


def delete_item(item_id: str, user_id: str) -> bool:
    """Delete an item. Returns True if deleted, False if not found."""
    settings = get_settings()
    if settings.use_mock_auth:
        return _delete_item_mock(item_id, user_id)
    return _delete_item_real(item_id, user_id)


def correct_item_tags(item_id: str, user_id: str, corrections: Dict) -> Optional[Dict]:
    """
    Apply user corrections (category and/or color) to an existing item.
    If category changes, item_type is automatically re-derived.
    Returns the updated item, or None if not found.
    """
    # Re-derive item_type if category is being changed
    if "category" in corrections:
        cat = corrections["category"]
        corrections["item_type"] = (
            "accessory"    if cat == "accessories" else
            "footwear"     if cat == "shoes"       else
            "outerwear"    if cat == "outerwear"   else
            "core_garment"
        )

    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import update
        return update(TABLE, item_id, corrections, extra_filters={"user_id": user_id})
    else:
        from utils.db import get_supabase
        result = (
            get_supabase().table(TABLE)
            .update(corrections)
            .eq("id", item_id)
            .eq("user_id", user_id)
            .select()
            .execute()
        )
        return result.data[0] if result.data else None


def find_duplicate(user_id: str, image_bytes: bytes, new_color: Optional[str] = None) -> Optional[dict]:
    """
    Compare new image embedding against all existing user items.
    Returns the most similar item if similarity >= DUPLICATE_THRESHOLD, else None.

    new_color: the AI-detected colour of the incoming item.  When supplied,
    candidates whose stored colour differs are skipped — same cut in a
    different colour is NOT a duplicate (e.g. blue jeans vs black jeans).
    """
    settings = get_settings()
    if not settings.use_mock_ai:
        from ml.embeddings import generate_embedding, cosine_similarity
        from utils.db import get_supabase
        import json

        new_embedding = generate_embedding("", image_bytes)

        # Query embedding vectors directly via rpc/raw — pgvector excluded from select("*")
        db = get_supabase()
        result = db.table("clothing_items").select(
            "id, category, color, image_url, embedding_vector"
        ).eq("user_id", user_id).execute()

        existing = result.data

        best_match = None
        best_score = 0.0

        for item in existing:
            # Skip items that differ in colour — same style in a different
            # colour is intentionally a distinct wardrobe piece.
            if new_color and item.get("color") and item["color"].lower() != new_color.lower():
                continue

            ev = item.get("embedding_vector")
            if not ev:
                continue
            # Handle both string and list formats
            if isinstance(ev, str):
                try:
                    ev = json.loads(ev)
                except Exception:
                    continue
            if not isinstance(ev, list) or len(ev) == 0:
                continue
            score = cosine_similarity(new_embedding, ev)
            if score > best_score:
                best_score = score
                best_match = item

        if best_score >= DUPLICATE_THRESHOLD and best_match:
            return {
                "id": best_match["id"],
                "category": best_match["category"],
                "color": best_match.get("color", ""),
                "image_url": best_match.get("image_url", ""),
                "score": round(best_score, 3),
            }
    return None
