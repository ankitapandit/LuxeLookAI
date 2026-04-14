"""
services/clothing_service.py — Wardrobe item CRUD
==================================================
Supports two modes (controlled by USE_MOCK_AUTH in .env):
  - Mock mode  → stores items in memory, images as data-URLs (no Supabase Storage needed)
  - Real mode  → uploads to Supabase Storage, persists to Supabase DB
"""

from __future__ import annotations
import base64
import io
import logging
import uuid
from datetime import datetime, timezone, timedelta
from collections import deque
from functools import lru_cache
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
MEDIA_PROCESSING_TIMEOUT = timedelta(minutes=15)

ITEM_LIST_FIELDS = (
    "id, user_id, category, item_type, accessory_subtype, color, pattern, "
    "season, formality_score, image_url, thumbnail_url, cutout_url, "
    "media_status, media_stage, media_error, media_updated_at, "
    "is_active, is_archived, archived_on, deleted_at, descriptors, created_at"
)


def _stringify_feedback_value(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _build_correction_feedback_rows(
    *,
    existing: Dict[str, Any],
    corrections: Dict[str, Any],
    item_id: str,
    user_id: str,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []

    tracked_fields = ("category", "color", "season", "formality_score")
    for field in tracked_fields:
        if field not in corrections:
            continue
        old_value = _stringify_feedback_value(existing.get(field))
        new_value = _stringify_feedback_value(corrections.get(field))
        if old_value == new_value or new_value is None:
            continue
        rows.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "item_id": item_id,
            "field_name": field,
            "old_value": old_value,
            "new_value": new_value,
            "item_category_snapshot": existing.get("category"),
            "item_color_snapshot": existing.get("color"),
            "item_season_snapshot": existing.get("season"),
            "item_formality_score_snapshot": existing.get("formality_score"),
            "item_descriptors_snapshot": existing.get("descriptors") or {},
            "feedback_source": "user_edit",
        })

    if "descriptors" in corrections:
        existing_descriptors = existing.get("descriptors") or {}
        next_descriptors = corrections.get("descriptors") or {}
        for key, value in next_descriptors.items():
            old_value = _stringify_feedback_value(existing_descriptors.get(key))
            new_value = _stringify_feedback_value(value)
            if old_value == new_value or new_value is None:
                continue
            rows.append({
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "item_id": item_id,
                "field_name": f"descriptor:{key}",
                "old_value": old_value,
                "new_value": new_value,
                "item_category_snapshot": existing.get("category"),
                "item_color_snapshot": existing.get("color"),
                "item_season_snapshot": existing.get("season"),
                "item_formality_score_snapshot": existing.get("formality_score"),
                "item_descriptors_snapshot": existing.get("descriptors") or {},
                "feedback_source": "user_edit",
            })

    return rows


def _make_thumbnail_bytes(image_bytes: bytes, max_size: int = 360) -> bytes:
    """Create a small WEBP thumbnail for grid/list usage."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(image_bytes)) as img:
        img = ImageOps.exif_transpose(img).convert("RGB")
        img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="WEBP", quality=82, method=6)
        return out.getvalue()


@lru_cache(maxsize=1)
def _get_rembg_session():
    from rembg import new_session
    return new_session("u2net")


def _color_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])


def _make_cutout_bytes_fallback(image_bytes: bytes, max_size: int = 900) -> bytes:
    """Fallback cutout generator when rembg is unavailable or fails."""
    from PIL import Image, ImageFilter, ImageOps

    with Image.open(io.BytesIO(image_bytes)) as img:
        img = ImageOps.exif_transpose(img).convert("RGBA")
        width, height = img.size
        pixels = img.load()

        def sample_point(x: int, y: int) -> tuple[int, int, int]:
            px = pixels[max(0, min(width - 1, x)), max(0, min(height - 1, y))]
            return (int(px[0]), int(px[1]), int(px[2]))

        edge_stride_x = max(1, width // 12)
        edge_stride_y = max(1, height // 12)
        samples = []
        for x in range(0, width, edge_stride_x):
            samples.append(sample_point(x, 0))
            samples.append(sample_point(x, height - 1))
        for y in range(0, height, edge_stride_y):
            samples.append(sample_point(0, y))
            samples.append(sample_point(width - 1, y))
        samples.extend([
            sample_point(0, 0),
            sample_point(width - 1, 0),
            sample_point(0, height - 1),
            sample_point(width - 1, height - 1),
        ])
        background = tuple(
            sorted(channel_values)[len(channel_values) // 2]
            for channel_values in zip(*samples)
        )

        threshold = 132
        local_threshold = 84
        visited = bytearray(width * height)
        mask = Image.new("L", (width, height), 255)
        mask_pixels = mask.load()
        queue = deque()

        def add_seed(x: int, y: int):
            idx = y * width + x
            if visited[idx]:
                return
            rgb = sample_point(x, y)
            if _color_distance(rgb, background) <= threshold:
                visited[idx] = 1
                queue.append((x, y, rgb))

        for x in range(width):
            add_seed(x, 0)
            add_seed(x, height - 1)
        for y in range(height):
            add_seed(0, y)
            add_seed(width - 1, y)

        while queue:
            x, y, parent_rgb = queue.popleft()
            mask_pixels[x, y] = 0
            for nx, ny in (
                (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1),
                (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1), (x + 1, y + 1),
            ):
                if nx < 0 or ny < 0 or nx >= width or ny >= height:
                    continue
                idx = ny * width + nx
                if visited[idx]:
                    continue
                rgb = sample_point(nx, ny)
                if _color_distance(rgb, background) <= threshold and _color_distance(rgb, parent_rgb) <= local_threshold:
                    visited[idx] = 1
                    queue.append((nx, ny, rgb))

        # Second pass: make near-background edge-connected pixels translucent rather than binary.
        soft_threshold = 170
        for y in range(height):
            for x in range(width):
                if mask_pixels[x, y] == 0:
                    continue
                rgb = sample_point(x, y)
                distance = _color_distance(rgb, background)
                if distance <= soft_threshold:
                    alpha = int(max(0, min(255, (distance - threshold) / max(1, soft_threshold - threshold) * 255)))
                    mask_pixels[x, y] = min(mask_pixels[x, y], alpha)

        mask = mask.filter(ImageFilter.GaussianBlur(radius=max(1, min(width, height) / 260)))
        cutout = img.copy()
        cutout.putalpha(mask)
        bbox = cutout.getbbox()
        if bbox:
            pad_x = max(10, int((bbox[2] - bbox[0]) * 0.08))
            pad_y = max(10, int((bbox[3] - bbox[1]) * 0.08))
            bbox = (
                max(0, bbox[0] - pad_x),
                max(0, bbox[1] - pad_y),
                min(width, bbox[2] + pad_x),
                min(height, bbox[3] + pad_y),
            )
            cutout = cutout.crop(bbox)

        cutout.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        cutout.save(out, format="PNG")
        return out.getvalue()


def _finalize_cutout_bytes(cutout_bytes: bytes, max_size: int = 900) -> bytes:
    """Trim, pad, and export a transparent wardrobe cutout."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(cutout_bytes)) as img:
        img = ImageOps.exif_transpose(img).convert("RGBA")

        alpha = img.getchannel("A")
        bbox = alpha.getbbox()
        if bbox:
            pad_x = max(10, int((bbox[2] - bbox[0]) * 0.08))
            pad_y = max(10, int((bbox[3] - bbox[1]) * 0.08))
            bbox = (
                max(0, bbox[0] - pad_x),
                max(0, bbox[1] - pad_y),
                min(img.width, bbox[2] + pad_x),
                min(img.height, bbox[3] + pad_y),
            )
            img = img.crop(bbox)

        img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="PNG")
        return out.getvalue()


def _make_cutout_bytes(image_bytes: bytes, max_size: int = 900) -> bytes:
    """Generate a transparent-background cutout best suited for moodboard compositions."""
    try:
        from rembg import remove

        removed = remove(
            image_bytes,
            session=_get_rembg_session(),
            alpha_matting=True,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=10,
            alpha_matting_erode_size=8,
        )
        return _finalize_cutout_bytes(removed, max_size=max_size)
    except Exception as e:
        logger.warning("rembg cutout generation failed; falling back to heuristic removal: %s", e)
        return _make_cutout_bytes_fallback(image_bytes, max_size=max_size)


def _extract_storage_paths(image_url: str = "", thumbnail_url: str = "", cutout_url: str = "") -> List[str]:
    paths: List[str] = []
    for url in [image_url, thumbnail_url, cutout_url]:
        if url and "/clothing-images/" in url:
            paths.append(url.split("/clothing-images/")[-1].split("?")[0])
    return paths


def _hard_delete_item_mock(item_id: str, user_id: str) -> bool:
    from utils.mock_db_store import select_one, delete as hard_delete

    row = select_one(TABLE, {"id": item_id, "user_id": user_id})
    if not row or row.get("is_active", True):
        return False
    hard_delete(TABLE, item_id, extra_filters={"user_id": user_id})
    return True


def _hard_delete_item_real(item_id: str, user_id: str) -> bool:
    from utils.db import get_supabase

    db = get_supabase()
    row = (
        db.table(TABLE)
        .select("id, image_url, thumbnail_url, cutout_url, is_active")
        .eq("id", item_id)
        .eq("user_id", user_id)
        .eq("is_active", False)
        .maybe_single()
        .execute()
        .data
    )
    if not row:
        return False

    paths = _extract_storage_paths(
        row.get("image_url", ""),
        row.get("thumbnail_url", ""),
        row.get("cutout_url", ""),
    )
    if paths:
        try:
            db.storage.from_("clothing-images").remove(paths)
        except Exception as e:
            logger.warning("Hard-delete storage cleanup failed for %s: %s", item_id, e)

    db.table(TABLE).delete().eq("id", item_id).eq("user_id", user_id).eq("is_active", False).execute()
    return True


def _media_timestamp() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


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
        "thumbnail_url":     None,
        "cutout_url":        None,
        "media_status":      "pending",
        "media_stage":       "queued",
        "media_error":       None,
        "media_updated_at":  _media_timestamp(),
        "is_active":         True,
        "is_archived":       False,
        "archived_on":       None,
        "deleted_at":        None,
        "embedding_vector":  embedding,
        "descriptors": tags.get("descriptors") or (manual_tags or {}).get("descriptors") or {},
    }
    return insert(TABLE, row)


def _get_items_mock(user_id: str) -> List[Dict]:
    from utils.mock_db_store import select_all
    rows = select_all(TABLE, {"user_id": user_id})
    active = [r for r in rows if r.get("is_active", True)]
    return sorted(active, key=lambda r: r.get("created_at", ""), reverse=True)


def _get_items_by_ids_mock(user_id: str, item_ids: List[str]) -> List[Dict[str, Any]]:
    from utils.mock_db_store import select_all

    wanted = set(item_ids)
    rows = select_all(TABLE, {"user_id": user_id})
    matched = [r for r in rows if r.get("is_active", True) and r.get("id") in wanted]
    return sorted(matched, key=lambda r: r.get("media_updated_at") or r.get("created_at", ""), reverse=True)


def _apply_item_filters_mock(
    items: List[Dict[str, Any]],
    category: Optional[str] = None,
    season: Optional[str] = None,
    formality: Optional[str] = None,
) -> List[Dict[str, Any]]:
    def matches(item: Dict[str, Any]) -> bool:
        if category and item.get("category") != category:
            return False
        if season:
            item_season = item.get("season")
            if not item_season or item_season != season:
                return False
        if formality:
            score = item.get("formality_score")
            if score is None:
                return False
            if formality == "Formal" and score < 0.75:
                return False
            if formality == "Smart casual" and (score < 0.50 or score >= 0.75):
                return False
            if formality == "Casual" and (score < 0.25 or score >= 0.50):
                return False
            if formality == "Loungewear" and score >= 0.25:
                return False
        return True

    return [item for item in items if matches(item)]


def _get_items_page_mock(
    user_id: str,
    limit: int,
    offset: int,
    category: Optional[str] = None,
    season: Optional[str] = None,
    formality: Optional[str] = None,
) -> Dict[str, Any]:
    active_items = _get_items_mock(user_id)
    filtered = _apply_item_filters_mock(
        active_items,
        category=category,
        season=season,
        formality=formality,
    )
    page = filtered[offset: offset + limit + 1]
    return {
        "items": page[:limit],
        "has_more": len(page) > limit,
        "total_count": len(active_items),
    }


def _get_deleted_items_mock(user_id: str) -> List[Dict]:
    from utils.mock_db_store import select_all
    rows = select_all(TABLE, {"user_id": user_id})
    deleted = [r for r in rows if not r.get("is_active", True)]
    return sorted(deleted, key=lambda r: r.get("archived_on") or r.get("deleted_at") or "", reverse=True)


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

    update(TABLE, item_id, {
        "is_active": True,
        "is_archived": False,
        "deleted_at": None,
        "archived_on": None,
    }, extra_filters={"user_id": user_id})
    return "restored"


def _backfill_missing_thumbnails_mock(user_id: str, force: bool = False) -> int:
    from utils.mock_db_store import select_all, update

    rows = select_all(TABLE, {"user_id": user_id})
    updated = 0
    for row in rows:
        if not row.get("is_active", True):
            continue
        if not force and row.get("thumbnail_url") and row.get("cutout_url"):
            continue
        image_url = row.get("image_url", "")
        if not image_url.startswith("data:") or ";base64," not in image_url:
            continue
        try:
            image_bytes = base64.b64decode(image_url.split(";base64,", 1)[1])
            updates: Dict[str, str] = {}
            if force or not row.get("thumbnail_url"):
                thumb_bytes = _make_thumbnail_bytes(image_bytes)
                updates["thumbnail_url"] = f"data:image/webp;base64,{base64.b64encode(thumb_bytes).decode()}"
            if force or not row.get("cutout_url"):
                cutout_bytes = _make_cutout_bytes(image_bytes)
                updates["cutout_url"] = f"data:image/png;base64,{base64.b64encode(cutout_bytes).decode()}"
            if updates:
                update(TABLE, row["id"], updates, extra_filters={"user_id": user_id})
                updated += 1
        except Exception as e:
            logger.warning("Mock media backfill failed for %s: %s", row.get("id"), e)
    return updated


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
        "thumbnail_url":     None,
        "cutout_url":        None,
        "media_status":      "pending",
        "media_stage":       "queued",
        "media_error":       None,
        "media_updated_at":  _media_timestamp(),
        "is_active":         True,
        "is_archived":       False,
        "archived_on":       None,
        "deleted_at":        None,
        "embedding_vector": vec_str,
        "descriptors": tags.get("descriptors") or (manual_tags or {}).get("descriptors") or {},
    }
    result = db.table(TABLE).insert(row).execute()
    return result.data[0]


def _get_items_real(user_id: str) -> List[Dict]:
    from utils.db import get_supabase
    _reconcile_stale_media_items_real(user_id)
    result = _execute_supabase_request(lambda: (
        get_supabase().table(TABLE)
        .select(ITEM_LIST_FIELDS)
        .eq("user_id", user_id)
        .eq("is_active", True)
        .order("created_at", desc=True)
    ))
    return result.data or []


def _get_items_by_ids_real(user_id: str, item_ids: List[str]) -> List[Dict[str, Any]]:
    from utils.db import get_supabase

    if not item_ids:
        return []

    _reconcile_stale_media_items_real(user_id)
    result = _execute_supabase_request(lambda: (
        get_supabase().table(TABLE)
        .select(ITEM_LIST_FIELDS)
        .eq("user_id", user_id)
        .eq("is_active", True)
        .in_("id", item_ids)
    ))
    items = result.data or []
    return sorted(items or [], key=lambda r: r.get("media_updated_at") or r.get("created_at", ""), reverse=True)


def _get_items_page_real(
    user_id: str,
    limit: int,
    offset: int,
    category: Optional[str] = None,
    season: Optional[str] = None,
    formality: Optional[str] = None,
) -> Dict[str, Any]:
    from utils.db import get_supabase

    _reconcile_stale_media_items_real(user_id)
    query = (
        get_supabase().table(TABLE)
        .select(ITEM_LIST_FIELDS)
        .eq("user_id", user_id)
        .eq("is_active", True)
    )
    total_count_query = (
        get_supabase().table(TABLE)
        .select("id")
        .eq("user_id", user_id)
        .eq("is_active", True)
    )

    if category:
        query = query.eq("category", category)
    if season:
        query = query.eq("season", season)
    if formality == "Formal":
        query = query.gte("formality_score", 0.75)
    elif formality == "Smart casual":
        query = query.gte("formality_score", 0.50).lt("formality_score", 0.75)
    elif formality == "Casual":
        query = query.gte("formality_score", 0.25).lt("formality_score", 0.50)
    elif formality == "Loungewear":
        query = query.lt("formality_score", 0.25)

    rows_result = _execute_supabase_request(lambda: (
        query.order("created_at", desc=True)
        .range(offset, offset + limit)
    ))
    total_count_result = _execute_supabase_request(lambda: total_count_query)
    rows = rows_result.data or []
    total_count = len(total_count_result.data or [])

    return {
        "items": rows[:limit],
        "has_more": len(rows) > limit,
        "total_count": total_count,
    }


def _get_deleted_items_real(user_id: str) -> List[Dict]:
    from utils.db import get_supabase
    result = _execute_supabase_request(lambda: (
        get_supabase().table(TABLE)
        .select("id, category, item_type, accessory_subtype, color, pattern, season, "
                "formality_score, image_url, thumbnail_url, cutout_url, descriptors, created_at, "
                "deleted_at, archived_on, is_archived")
        .eq("user_id", user_id)
        .eq("is_active", False)
        .order("archived_on", desc=True)
    ))
    return result.data or []


def _delete_item_real(item_id: str, user_id: str) -> bool:
    """Soft-delete via SECURITY DEFINER RPC — reliable regardless of PostgREST UPDATE quirks."""
    from utils.db import get_supabase
    db = get_supabase()
    result = db.rpc("soft_delete_clothing_item", {
        "p_item_id": item_id,
        "p_user_id": user_id,
    }).execute()
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
        .select("id, category, color, item_type, image_url, thumbnail_url, cutout_url, embedding_vector, created_at")
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
            paths = _extract_storage_paths(
                trash_item.get("image_url", ""),
                trash_item.get("thumbnail_url", ""),
                trash_item.get("cutout_url", ""),
            )
            if paths:
                try:
                    db.storage.from_("clothing-images").remove(paths)
                except Exception as e:
                    logger.warning("Auto-purge storage cleanup failed for %s: %s", item_id, e)
            # Hard-delete the DB row
            db.table(TABLE).delete().eq("id", item_id).eq("user_id", user_id).execute()
            return "auto_purged"
        return "duplicate_conflict"

    # No duplicate — restore normally via SECURITY DEFINER RPC
    db.rpc("restore_clothing_item", {
        "p_item_id": item_id,
        "p_user_id": user_id,
    }).execute()
    return "restored"


def _backfill_missing_thumbnails_real(user_id: str, force: bool = False) -> int:
    from utils.db import get_supabase

    db = get_supabase()
    rows = (
        db.table(TABLE)
        .select("id, image_url, thumbnail_url, cutout_url")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .execute()
        .data
    )

    updated = 0
    for row in rows:
        if not force and row.get("thumbnail_url") and row.get("cutout_url"):
            continue
        image_url = row.get("image_url", "")
        paths = _extract_storage_paths(image_url=image_url)
        if not paths:
            continue
        original_path = paths[0]
        thumb_path = f"{user_id}/{row['id']}/thumb.webp"
        cutout_path = f"{user_id}/{row['id']}/cutout.png"
        try:
            original = db.storage.from_(STORAGE_BUCKET).download(original_path)
            if hasattr(original, "read"):
                original = original.read()
            updates: Dict[str, str] = {}
            if force or not row.get("thumbnail_url"):
                thumb_bytes = _make_thumbnail_bytes(original)
                db.storage.from_(STORAGE_BUCKET).upload(
                    thumb_path,
                    thumb_bytes,
                    {"content-type": "image/webp", "upsert": "true"},
                )
                updates["thumbnail_url"] = db.storage.from_(STORAGE_BUCKET).get_public_url(thumb_path).rstrip("?")
            if force or not row.get("cutout_url"):
                cutout_bytes = _make_cutout_bytes(original)
                db.storage.from_(STORAGE_BUCKET).upload(
                    cutout_path,
                    cutout_bytes,
                    {"content-type": "image/png", "upsert": "true"},
                )
                updates["cutout_url"] = db.storage.from_(STORAGE_BUCKET).get_public_url(cutout_path).rstrip("?")
            if updates:
                db.table(TABLE).update(updates).eq("id", row["id"]).eq("user_id", user_id).execute()
                updated += 1
        except Exception as e:
            logger.warning("Media backfill failed for %s: %s", row.get("id"), e)
    return updated


def _update_media_status_mock(
    item_id: str,
    user_id: str,
    status: str,
    stage: Optional[str] = None,
    error: Optional[str] = None,
    extra_updates: Optional[Dict[str, Any]] = None,
) -> None:
    from utils.mock_db_store import update

    updates: Dict[str, Any] = {
        "media_status": status,
        "media_stage": stage,
        "media_error": error,
        "media_updated_at": _media_timestamp(),
    }
    if extra_updates:
        updates.update(extra_updates)
    update(TABLE, item_id, updates, extra_filters={"user_id": user_id})


def _update_media_status_real(
    item_id: str,
    user_id: str,
    status: str,
    stage: Optional[str] = None,
    error: Optional[str] = None,
    extra_updates: Optional[Dict[str, Any]] = None,
) -> None:
    from utils.db import get_supabase

    db = get_supabase()
    updates: Dict[str, Any] = {
        "media_status": status,
        "media_stage": stage,
        "media_error": error,
        "media_updated_at": _media_timestamp(),
    }
    if extra_updates:
        updates.update(extra_updates)
    db.table(TABLE).update(updates).eq("id", item_id).eq("user_id", user_id).execute()


def _parse_media_timestamp(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _execute_supabase_request(factory):
    from httpx import RemoteProtocolError
    from utils.db import reset_supabase_client

    last_error: Optional[BaseException] = None
    for attempt in range(2):
        try:
            return factory().execute()
        except (RemoteProtocolError, KeyError) as exc:
            last_error = exc
            reset_supabase_client()
    if last_error is not None:
        raise last_error
    return None


def _reconcile_stale_media_items_real(user_id: str) -> int:
    from utils.db import get_supabase

    result = _execute_supabase_request(lambda: (
        get_supabase().table(TABLE)
        .select("id, media_status, media_stage, media_updated_at")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .in_("media_status", ["pending", "processing"])
    ))
    rows = (getattr(result, "data", None) or []) if result is not None else []

    if not rows:
        return 0

    now = datetime.now(timezone.utc)
    stale_count = 0
    for row in rows:
        updated_at = _parse_media_timestamp(row.get("media_updated_at"))
        if not updated_at:
            continue
        if now - updated_at <= MEDIA_PROCESSING_TIMEOUT:
            continue
        error = "Media processing timed out — please upload again."
        _execute_supabase_request(lambda: (
            get_supabase().table(TABLE).update({
                "media_status": "failed",
                "media_stage": "complete",
                "media_error": error,
                "media_updated_at": _media_timestamp(),
            }).eq("id", row["id"]).eq("user_id", user_id)
        ))
        stale_count += 1
    return stale_count


def update_media_status(
    item_id: str,
    user_id: str,
    status: str,
    stage: Optional[str] = None,
    error: Optional[str] = None,
    extra_updates: Optional[Dict[str, Any]] = None,
) -> None:
    settings = get_settings()
    if settings.use_mock_auth:
        _update_media_status_mock(item_id, user_id, status, stage=stage, error=error, extra_updates=extra_updates)
    else:
        _update_media_status_real(item_id, user_id, status, stage=stage, error=error, extra_updates=extra_updates)


def _process_item_media_mock(item_id: str, user_id: str, image_bytes: bytes) -> None:
    update_media_status(item_id, user_id, "processing", stage="thumbnail", error=None)
    thumbnail_url = f"data:image/webp;base64,{base64.b64encode(_make_thumbnail_bytes(image_bytes)).decode()}"
    update_media_status(item_id, user_id, "processing", stage="cutout", error=None, extra_updates={"thumbnail_url": thumbnail_url})
    cutout_url = f"data:image/png;base64,{base64.b64encode(_make_cutout_bytes(image_bytes)).decode()}"
    update_media_status(
        item_id,
        user_id,
        "ready",
        stage="complete",
        error=None,
        extra_updates={"thumbnail_url": thumbnail_url, "cutout_url": cutout_url},
    )


def _process_item_media_real(item_id: str, user_id: str, image_bytes: bytes) -> None:
    from utils.db import get_supabase

    db = get_supabase()
    thumb_path = f"{user_id}/{item_id}/thumb.webp"
    cutout_path = f"{user_id}/{item_id}/cutout.png"

    update_media_status(item_id, user_id, "processing", stage="thumbnail", error=None)
    thumbnail_bytes = _make_thumbnail_bytes(image_bytes)

    db.storage.from_(STORAGE_BUCKET).upload(
        thumb_path,
        thumbnail_bytes,
        {"content-type": "image/webp", "upsert": "true"},
    )
    thumbnail_url = db.storage.from_(STORAGE_BUCKET).get_public_url(thumb_path).rstrip("?")
    update_media_status(item_id, user_id, "processing", stage="cutout", error=None, extra_updates={"thumbnail_url": thumbnail_url})

    cutout_bytes = _make_cutout_bytes(image_bytes)
    db.storage.from_(STORAGE_BUCKET).upload(
        cutout_path,
        cutout_bytes,
        {"content-type": "image/png", "upsert": "true"},
    )

    update_media_status(
        item_id,
        user_id,
        "ready",
        stage="complete",
        error=None,
        extra_updates={
            "thumbnail_url": thumbnail_url,
            "cutout_url": db.storage.from_(STORAGE_BUCKET).get_public_url(cutout_path).rstrip("?"),
        },
    )


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


def process_item_media(item_id: str, user_id: str, image_bytes: bytes) -> None:
    """Generate thumbnail/cutout media for an already-saved wardrobe item."""
    settings = get_settings()
    try:
        if settings.use_mock_auth:
            _process_item_media_mock(item_id, user_id, image_bytes)
        else:
            _process_item_media_real(item_id, user_id, image_bytes)
    except Exception as e:
        update_media_status(
            item_id,
            user_id,
            "failed",
            stage="complete",
            error=str(e)[:240],
        )
        logger.warning("Deferred media generation failed for item %s: %s", item_id, e)


def get_user_items(user_id: str) -> List[Dict[str, Any]]:
    """Fetch all active clothing items belonging to a user."""
    settings = get_settings()
    if settings.use_mock_auth:
        return _get_items_mock(user_id)
    return _get_items_real(user_id)


def get_user_items_by_ids(user_id: str, item_ids: List[str]) -> List[Dict[str, Any]]:
    """Fetch specific active wardrobe items, including media-processing status fields."""
    if not item_ids:
        return []
    settings = get_settings()
    if settings.use_mock_auth:
        return _get_items_by_ids_mock(user_id, item_ids)
    return _get_items_by_ids_real(user_id, item_ids)


def get_user_items_page(
    user_id: str,
    limit: int,
    offset: int,
    category: Optional[str] = None,
    season: Optional[str] = None,
    formality: Optional[str] = None,
) -> Dict[str, Any]:
    """Fetch a paginated slice of active wardrobe items with optional server-side filters."""
    settings = get_settings()
    if settings.use_mock_auth:
        return _get_items_page_mock(
            user_id,
            limit=limit,
            offset=offset,
            category=category,
            season=season,
            formality=formality,
        )
    return _get_items_page_real(
        user_id,
        limit=limit,
        offset=offset,
        category=category,
        season=season,
        formality=formality,
    )


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


def delete_archived_item(item_id: str, user_id: str) -> bool:
    """Permanently delete an item from the archive/trash view."""
    settings = get_settings()
    if settings.use_mock_auth:
        return _hard_delete_item_mock(item_id, user_id)
    return _hard_delete_item_real(item_id, user_id)


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


def backfill_missing_thumbnails(user_id: str, force: bool = False) -> int:
    """Generate processed media for active wardrobe items missing thumbnails or cutouts."""
    settings = get_settings()
    if settings.use_mock_auth:
        return _backfill_missing_thumbnails_mock(user_id, force=force)
    return _backfill_missing_thumbnails_real(user_id, force=force)


def _purge_old_deleted_mock(user_id: str, days: int) -> int:
    from datetime import datetime, timezone, timedelta
    from utils.mock_db_store import select_all, delete as hard_delete

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    rows = select_all(TABLE, {"user_id": user_id})
    purged = 0
    for row in rows:
        if row.get("is_active", True):
            continue
        archived_at_str = row.get("archived_on") or row.get("deleted_at") or ""
        try:
            archived_at = datetime.fromisoformat(archived_at_str.replace("Z", "+00:00"))
        except ValueError:
            continue
        if archived_at <= cutoff:
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
        .select("id, image_url, thumbnail_url, cutout_url, archived_on, deleted_at")
        .eq("user_id", user_id)
        .eq("is_active", False)
        .or_(f"archived_on.lt.{cutoff},deleted_at.lt.{cutoff}")
        .execute()
        .data
    )
    if not rows:
        return 0

    # Storage cleanup — non-blocking
    for row in rows:
        paths = _extract_storage_paths(
            row.get("image_url", ""),
            row.get("thumbnail_url", ""),
            row.get("cutout_url", ""),
        )
        if paths:
            try:
                db.storage.from_("clothing-images").remove(paths)
            except Exception as e:
                logger.warning("Purge storage cleanup failed for %s: %s", row["id"], e)

    # Hard-delete DB rows
    ids = [row["id"] for row in rows]
    db.table(TABLE).delete().in_("id", ids).execute()
    return len(ids)


def correct_item_tags(item_id: str, user_id: str, corrections: Dict) -> Optional[Dict]:
    """
    Apply user corrections to an existing item.
    Handles both addition (new descriptor key) and modification (existing key).
    Descriptor updates are always merged into the existing JSONB — never a full replace.
    If category changes, item_type is automatically re-derived.
    Returns the updated item, or None if not found.
    """
    # Re-derive item_type if category is being changed
    if "category" in corrections:
        cat = corrections["category"]
        corrections["item_type"] = (
            "accessory"    if cat in {"accessories", "jewelry"} else
            "footwear"     if cat == "shoes"       else
            "outerwear"    if cat == "outerwear"   else
            "core_garment"
        )

    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import insert_many, select_one, update as mock_update

        # Descriptor update: merge incoming keys with existing ones (add or modify)
        existing = select_one(TABLE, {"id": item_id, "user_id": user_id})
        if "descriptors" in corrections:
            if existing:
                merged = {**existing.get("descriptors", {}), **corrections["descriptors"]}
                corrections = {**corrections, "descriptors": merged}

        updated = mock_update(TABLE, item_id, corrections, extra_filters={"user_id": user_id})
        if updated and existing:
            feedback_rows = _build_correction_feedback_rows(
                existing=existing,
                corrections=corrections,
                item_id=item_id,
                user_id=user_id,
            )
            if feedback_rows:
                insert_many("clothing_tag_feedback", feedback_rows)
        return updated
    else:
        from utils.db import get_supabase
        import json as _json
        db = get_supabase()

        existing = (
            db.table(TABLE)
            .select("id, category, color, season, formality_score, descriptors")
            .eq("id", item_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
            .data
        )
        if not existing:
            return None

        # Use SECURITY DEFINER RPC — PostgREST table UPDATE is unreliable for this project.
        # The RPC merges p_descriptors into existing descriptors via JSONB || operator,
        # so individual keys are added or overwritten without affecting unrelated keys.
        desc = corrections.get("descriptors")
        rpc_args: Dict[str, Any] = {
            "p_item_id":         item_id,
            "p_user_id":         user_id,
            "p_category":        corrections.get("category"),
            "p_color":           corrections.get("color"),
            "p_season":          corrections.get("season"),
            "p_formality_score": corrections.get("formality_score"),
            "p_item_type":       corrections.get("item_type"),
            "p_descriptors":     _json.dumps(desc) if desc else None,
        }
        result = db.rpc("update_clothing_item_tags", rpc_args).execute()
        updated = result.data if result.data else None
        if not updated:
            return None

        feedback_rows = _build_correction_feedback_rows(
            existing=existing,
            corrections=corrections,
            item_id=item_id,
            user_id=user_id,
        )
        if feedback_rows:
            db.table("clothing_tag_feedback").insert(feedback_rows).execute()
        return updated


def find_duplicate(user_id: str, image_bytes: bytes, new_color: Optional[str] = None) -> Optional[dict]:
    """
    Compare new image embedding against all existing user items.
    Returns the most similar item if similarity >= DUPLICATE_THRESHOLD, else None.

    new_color: the AI-detected colour of the incoming item. When supplied,
    candidates must be in the same broad colour family to count as duplicates,
    so nearby shades can still match while clearly different colours remain
    distinct wardrobe items.
    """
    settings = get_settings()
    if not settings.use_mock_ai:
        from ml.embeddings import generate_embedding, cosine_similarity
        from utils.db import get_supabase
        from utils.color_utils import same_color_family
        import json

        new_embedding = generate_embedding("", image_bytes)

        # Query embedding vectors directly via rpc/raw — pgvector excluded from select("*")
        db = get_supabase()
        result = db.table("clothing_items").select(
            "id, category, color, image_url, embedding_vector, is_active, is_archived"
        ).eq("user_id", user_id).execute()

        existing = result.data

        best_match = None
        best_score = 0.0

        for item in existing:
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
            color_matches = True
            if new_color and item.get("color"):
                color_matches = same_color_family(item.get("color"), new_color)
            if score >= DUPLICATE_THRESHOLD and color_matches and score > best_score:
                best_score = score
                best_match = item

        if best_match:
            return {
                "id": best_match["id"],
                "category": best_match["category"],
                "color": best_match.get("color", ""),
                "image_url": best_match.get("image_url", ""),
                "is_active": bool(best_match.get("is_active", True)),
                "is_archived": bool(best_match.get("is_archived", False)),
                "score": round(best_score, 3),
            }
    return None
