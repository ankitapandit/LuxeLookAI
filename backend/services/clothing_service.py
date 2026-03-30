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
from typing import List, Dict, Any, Optional, Literal
from config import get_settings
from ml.tagger import tag_clothing_item
from ml.embeddings import generate_embedding

# Typed result for restore_item() — callers switch on this string
RestoreResult = Literal["restored", "not_found", "duplicate_conflict", "auto_purged"]

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
    rows = select_all(TABLE, {"user_id": user_id})
    return [r for r in rows if r.get("is_active", True)]


def _get_deleted_items_mock(user_id: str) -> List[Dict]:
    from utils.mock_db_store import select_all
    rows = select_all(TABLE, {"user_id": user_id})
    return [r for r in rows if not r.get("is_active", True)]


def _delete_item_mock(item_id: str, user_id: str) -> bool:
    from utils.mock_db_store import soft_delete
    return soft_delete(TABLE, item_id, extra_filters={"user_id": user_id})


def _restore_item_mock(item_id: str, user_id: str) -> RestoreResult:
    """
    Restore with duplicate guard (mock mode).
    Duplicate check: same category + color + item_type among active items.
    Timestamp tiebreak: if active item was created after the trash item → auto-purge.
    """
    from utils.mock_db_store import select_all, update, delete as hard_delete

    rows = select_all(TABLE, {"user_id": user_id})
    trash_item = next((r for r in rows if r.get("id") == item_id and not r.get("is_active", True)), None)
    if not trash_item:
        return "not_found"

    # Find an active item with the same category + color + item_type
    duplicate = next(
        (
            r for r in rows
            if r.get("is_active", True)
            and r["id"] != item_id
            and r.get("category") == trash_item.get("category")
            and r.get("color")    == trash_item.get("color")
            and r.get("item_type") == trash_item.get("item_type")
        ),
        None,
    )

    if duplicate:
        # Auto-purge if the active item is newer (it's the replacement)
        if (duplicate.get("created_at") or "") >= (trash_item.get("created_at") or ""):
            hard_delete(TABLE, item_id, extra_filters={"user_id": user_id})
            return "auto_purged"
        return "duplicate_conflict"

    update(TABLE, item_id, {"is_active": True, "deleted_at": None},
           extra_filters={"user_id": user_id})
    return "restored"


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
    items = (
        db.table(TABLE)
        .select("*, embedding_vector")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .execute().data
    )
    # Parse embedding_vector from string back to list if needed
    for item in items:
        ev = item.get("embedding_vector")
        if isinstance(ev, str):
            try:
                item["embedding_vector"] = [float(x) for x in ev.strip("[]").split(",")]
            except Exception:
                item["embedding_vector"] = None
    return items


def _get_deleted_items_real(user_id: str) -> List[Dict]:
    from utils.db import get_supabase
    db = get_supabase()
    return (
        db.table(TABLE)
        .select("id, category, item_type, color, image_url, deleted_at")
        .eq("user_id", user_id)
        .eq("is_active", False)
        .order("deleted_at", desc=True)
        .execute().data
    )


def _delete_item_real(item_id: str, user_id: str) -> bool:
    """Soft-delete: mark is_active=False, preserve storage so item can be restored."""
    from utils.db import get_supabase
    from datetime import datetime, timezone
    db = get_supabase()
    result = (
        db.table(TABLE)
        .update({"is_active": False, "deleted_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", item_id)
        .eq("user_id", user_id)
        .execute()
    )
    return bool(result.data)


def _restore_item_real(item_id: str, user_id: str) -> RestoreResult:
    """
    Restore with duplicate guard (real mode).
    Duplicate check: embedding cosine similarity ≥ DUPLICATE_THRESHOLD among active items.
    Timestamp tiebreak: active.created_at > trash.created_at → item is a replacement → auto-purge.
    """
    import json
    from utils.db import get_supabase
    from ml.embeddings import cosine_similarity

    db = get_supabase()

    # Fetch the trashed item (need embedding + timestamp for comparison)
    trash_rows = (
        db.table(TABLE)
        .select("id, category, color, item_type, image_url, embedding_vector, created_at")
        .eq("id", item_id)
        .eq("user_id", user_id)
        .eq("is_active", False)
        .execute()
        .data
    )
    if not trash_rows:
        return "not_found"
    trash_item = trash_rows[0]

    # Parse embedding
    trash_ev = trash_item.get("embedding_vector")
    if isinstance(trash_ev, str):
        try:
            trash_ev = json.loads(trash_ev)
        except Exception:
            trash_ev = None

    # Find potential duplicates among active items
    active_items = (
        db.table(TABLE)
        .select("id, embedding_vector, created_at, category, color, item_type")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .execute()
        .data
    )

    duplicate = None
    if trash_ev:
        for item in active_items:
            ev = item.get("embedding_vector")
            if isinstance(ev, str):
                try:
                    ev = json.loads(ev)
                except Exception:
                    continue
            if not ev:
                continue
            if cosine_similarity(trash_ev, ev) >= DUPLICATE_THRESHOLD:
                duplicate = item
                break
    else:
        # Fallback when no embedding: match on category + color + item_type
        duplicate = next(
            (
                i for i in active_items
                if i.get("category")  == trash_item.get("category")
                and i.get("color")    == trash_item.get("color")
                and i.get("item_type") == trash_item.get("item_type")
            ),
            None,
        )

    if duplicate:
        # Auto-purge: active item was created after the trashed item → it's a replacement
        if (duplicate.get("created_at") or "") >= (trash_item.get("created_at") or ""):
            # Remove storage file
            image_url = trash_item.get("image_url", "")
            if image_url and "/clothing-images/" in image_url:
                try:
                    path = image_url.split("/clothing-images/")[-1].split("?")[0]
                    db.storage.from_("clothing-images").remove([path])
                except Exception as e:
                    logger.warning("Auto-purge storage cleanup failed for %s: %s", item_id, e)
            # Hard-delete the DB row
            db.table(TABLE).delete().eq("id", item_id).eq("user_id", user_id).execute()
            return "auto_purged"
        return "duplicate_conflict"

    # No duplicate — restore normally
    db.table(TABLE).update({"is_active": True, "deleted_at": None}).eq("id", item_id).eq("user_id", user_id).execute()
    return "restored"


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
    """Fetch all active clothing items belonging to a user."""
    settings = get_settings()
    if settings.use_mock_auth:
        return _get_items_mock(user_id)
    return _get_items_real(user_id)


def get_deleted_items(user_id: str) -> List[Dict[str, Any]]:
    """Fetch soft-deleted items for a user (trash view)."""
    settings = get_settings()
    if settings.use_mock_auth:
        return _get_deleted_items_mock(user_id)
    return _get_deleted_items_real(user_id)


def delete_item(item_id: str, user_id: str) -> bool:
    """Soft-delete an item (is_active=False). Returns True if found."""
    settings = get_settings()
    if settings.use_mock_auth:
        return _delete_item_mock(item_id, user_id)
    return _delete_item_real(item_id, user_id)


def restore_item(item_id: str, user_id: str) -> RestoreResult:
    """
    Attempt to restore a soft-deleted item.

    Returns one of:
      "restored"           — item moved back to active wardrobe
      "not_found"          — item not in trash (already active or doesn't exist)
      "duplicate_conflict" — a similar active item exists but is OLDER; user must decide
      "auto_purged"        — a newer active replacement was found; trash item hard-deleted automatically
    """
    settings = get_settings()
    if settings.use_mock_auth:
        return _restore_item_mock(item_id, user_id)
    return _restore_item_real(item_id, user_id)


def purge_old_deleted_items(user_id: str, days: int = 90) -> int:
    """
    Hard-delete items that have been in trash for ≥ `days` days.
    Removes both the DB row and the associated storage file.
    Returns the count of items purged.
    """
    settings = get_settings()
    if settings.use_mock_auth:
        return _purge_old_deleted_mock(user_id, days)
    return _purge_old_deleted_real(user_id, days)


def _purge_old_deleted_mock(user_id: str, days: int) -> int:
    from datetime import datetime, timezone, timedelta
    from utils.mock_db_store import select_all, delete as hard_delete

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = select_all(TABLE, {"user_id": user_id})
    purged = 0
    for row in rows:
        if row.get("is_active", True):
            continue
        deleted_at_str = row.get("deleted_at") or ""
        try:
            deleted_at = datetime.fromisoformat(deleted_at_str.replace("Z", "+00:00"))
        except ValueError:
            continue
        if deleted_at <= cutoff:
            hard_delete(TABLE, row["id"])
            purged += 1
    return purged


def _purge_old_deleted_real(user_id: str, days: int) -> int:
    from datetime import datetime, timezone, timedelta
    from utils.db import get_supabase

    db = get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    # Fetch rows to purge (need image_url for storage cleanup)
    rows = (
        db.table(TABLE)
        .select("id, image_url")
        .eq("user_id", user_id)
        .eq("is_active", False)
        .lt("deleted_at", cutoff)
        .execute()
        .data
    )
    if not rows:
        return 0

    # Storage cleanup — non-blocking
    for row in rows:
        image_url = row.get("image_url", "")
        if image_url and "/clothing-images/" in image_url:
            try:
                path = image_url.split("/clothing-images/")[-1].split("?")[0]
                db.storage.from_("clothing-images").remove([path])
            except Exception as e:
                logger.warning("Purge storage cleanup failed for %s: %s", row["id"], e)

    # Hard-delete DB rows
    ids = [row["id"] for row in rows]
    db.table(TABLE).delete().in_("id", ids).execute()
    logger.info("Purged %d items older than %d days for user %s", len(ids), days, user_id)
    return len(ids)


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
