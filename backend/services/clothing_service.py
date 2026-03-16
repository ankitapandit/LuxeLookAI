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
    image_url = db.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)

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
    }
    result = db.table(TABLE).insert(row).execute()
    return result.data[0]


def _get_items_real(user_id: str) -> List[Dict]:
    from utils.db import get_supabase
    db = get_supabase()
    return db.table(TABLE).select("*").eq("user_id", user_id).execute().data


def _delete_item_real(item_id: str, user_id: str) -> bool:
    from utils.db import get_supabase
    db = get_supabase()
    result = db.table(TABLE).delete().eq("id", item_id).eq("user_id", user_id).execute()
    return len(result.data) > 0


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
            .execute()
        )
        return result.data[0] if result.data else None

