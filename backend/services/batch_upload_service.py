"""
services/batch_upload_service.py — Batch wardrobe ingestion service
====================================================================
Orchestrates multi-photo upload sessions without duplicating any tagging
or media-processing logic.  All heavy lifting is delegated to the existing
clothing_service pipeline.

Session lifecycle
-----------------
  queued → uploading → processing → awaiting_verification
                                  ↘ completed
                                  ↘ completed_with_errors

Item lifecycle
--------------
  queued → uploaded → tagging → awaiting_verification → verified
                              ↘ failed                → rejected

Public API
----------
  create_session(user_id, total_count)                → BatchSession dict
  create_item(session_id, user_id, file_name)         → BatchItem dict
  process_item(item_id, user_id, image_bytes, filename) → BatchItem dict
  verify_item(item_id, user_id)                       → BatchItem dict
  reject_item(item_id, user_id)                       → BatchItem dict
  get_session(session_id, user_id)                    → BatchSessionWithItems dict | None
  list_sessions(user_id, limit)                       → list[BatchSession dict]
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from config import get_settings

logger = logging.getLogger(__name__)

# ─── Table names ─────────────────────────────────────────────────────────────

SESSION_TABLE = "upload_batch_sessions"
ITEM_TABLE    = "upload_batch_items"
CLOTHING_TABLE = "clothing_items"

# ─── Helpers ─────────────────────────────────────────────────────────────────

def _debug(event: str, **details: Any) -> None:
    if details:
        detail_str = " ".join(f"{key}={details[key]!r}" for key in sorted(details))
        logger.info("[BatchUpload][Service] %s %s", event, detail_str)
    else:
        logger.info("[BatchUpload][Service] %s", event)

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _use_mock() -> bool:
    return get_settings().use_mock_auth


# ── Mock store ────────────────────────────────────────────────────────────────
# In mock mode we piggyback on the existing mock_db_store utilities.

def _mock_insert(table: str, row: Dict[str, Any]) -> Dict[str, Any]:
    from utils.mock_db_store import insert
    return insert(table, row)


def _mock_update(table: str, row_id: str, updates: Dict[str, Any], user_id: str) -> Optional[Dict[str, Any]]:
    from utils.mock_db_store import update
    return update(table, row_id, updates, extra_filters={"user_id": user_id})


def _mock_select_one(table: str, filters: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    from utils.mock_db_store import select_one
    return select_one(table, filters)


def _mock_select_all(table: str, filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    from utils.mock_db_store import select_all
    return select_all(table, filters)


# ─── Session aggregate recompute ──────────────────────────────────────────────

def _recompute_session_counters(session_id: str, user_id: str) -> None:
    """
    Recalculate session aggregate counters from item rows and pick the
    appropriate session status.  Called after any item status change.
    """
    if _use_mock():
        items = _mock_select_all(ITEM_TABLE, {"session_id": session_id, "user_id": user_id})
        session = _mock_select_one(SESSION_TABLE, {"id": session_id, "user_id": user_id})
    else:
        from utils.db import get_supabase
        db = get_supabase()
        items = (
            db.table(ITEM_TABLE)
            .select("status")
            .eq("session_id", session_id)
            .eq("user_id", user_id)
            .execute()
            .data
        ) or []
        session_rows = (
            db.table(SESSION_TABLE)
            .select("total_count")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .execute()
            .data
        )
        session = session_rows[0] if session_rows else None

    if not session:
        return

    statuses = [i.get("status", "") for i in items]
    total         = session.get("total_count", len(items))
    uploaded      = sum(1 for s in statuses if s in {"uploaded", "tagging", "tagged", "awaiting_verification", "verified", "rejected"})
    processed     = sum(1 for s in statuses if s in {"tagged", "awaiting_verification", "verified", "rejected", "failed"})
    awaiting      = sum(1 for s in statuses if s == "awaiting_verification")
    verified      = sum(1 for s in statuses if s == "verified")
    failed        = sum(1 for s in statuses if s == "failed")

    # Derive session status
    all_terminal = all(s in {"awaiting_verification", "verified", "rejected", "failed"} for s in statuses)
    all_done     = all(s in {"verified", "rejected", "failed"} for s in statuses)

    if all_done and statuses:
        new_status = "completed_with_errors" if failed else "completed"
    elif awaiting > 0:
        new_status = "awaiting_verification"
    elif processed > 0:
        new_status = "processing"
    elif uploaded > 0:
        new_status = "uploading"
    else:
        new_status = "queued"

    updates: Dict[str, Any] = {
        "uploaded_count":              uploaded,
        "processed_count":             processed,
        "awaiting_verification_count": awaiting,
        "verified_count":              verified,
        "failed_count":                failed,
        "status":                      new_status,
        "updated_at":                  _now(),
    }
    if all_done and statuses and "completed" in new_status:
        updates["completed_at"] = _now()

    if _use_mock():
        _mock_update(SESSION_TABLE, session_id, updates, user_id)
    else:
        from utils.db import get_supabase
        db = get_supabase()
        db.table(SESSION_TABLE).update(updates).eq("id", session_id).eq("user_id", user_id).execute()
    _debug(
        "session_recomputed",
        session_id=session_id,
        user_id=user_id,
        status=new_status,
        uploaded=uploaded,
        processed=processed,
        awaiting=awaiting,
        verified=verified,
        failed=failed,
        total=total,
    )


# ─── Item status helper ───────────────────────────────────────────────────────

def _set_item_status(
    item_id: str,
    user_id: str,
    session_id: str,
    status: str,
    extra: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    updates: Dict[str, Any] = {"status": status, "updated_at": _now()}
    if extra:
        updates.update(extra)
    if _use_mock():
        row = _mock_update(ITEM_TABLE, item_id, updates, user_id)
    else:
        from utils.db import get_supabase
        db = get_supabase()
        rows = (
            db.table(ITEM_TABLE)
            .update(updates)
            .eq("id", item_id)
            .eq("user_id", user_id)
            .execute()
            .data
        )
        row = rows[0] if rows else None
    _debug("item_status_set", item_id=item_id, session_id=session_id, user_id=user_id, status=status)
    _recompute_session_counters(session_id, user_id)
    return row


# ─── Public API ──────────────────────────────────────────────────────────────

def create_session(user_id: str, total_count: int) -> Dict[str, Any]:
    """Create a new batch session row and return it."""
    row: Dict[str, Any] = {
        "id":                          str(uuid.uuid4()),
        "user_id":                     user_id,
        "status":                      "queued",
        "total_count":                 total_count,
        "uploaded_count":              0,
        "processed_count":             0,
        "awaiting_verification_count": 0,
        "verified_count":              0,
        "failed_count":                0,
        "created_at":                  _now(),
        "updated_at":                  _now(),
        "completed_at":                None,
    }
    if _use_mock():
        created = _mock_insert(SESSION_TABLE, row)
        _debug("session_created", session_id=created["id"], user_id=user_id, total_count=total_count, mode="mock")
        return created
    from utils.db import get_supabase
    db = get_supabase()
    result = db.table(SESSION_TABLE).insert(row).execute()
    created = result.data[0]
    _debug("session_created", session_id=created["id"], user_id=user_id, total_count=total_count, mode="real")
    return created


def create_item(session_id: str, user_id: str, file_name: Optional[str] = None) -> Dict[str, Any]:
    """Create a queued batch item row.  Call once per file before uploading."""
    row: Dict[str, Any] = {
        "id":               str(uuid.uuid4()),
        "session_id":       session_id,
        "user_id":          user_id,
        "file_name":        file_name,
        "image_url":        None,
        "thumbnail_url":    None,
        "cutout_url":       None,
        "status":           "queued",
        "error_message":    None,
        "clothing_item_id": None,
        "created_at":       _now(),
        "updated_at":       _now(),
        "verified_at":      None,
    }
    if _use_mock():
        inserted = _mock_insert(ITEM_TABLE, row)
    else:
        from utils.db import get_supabase
        db = get_supabase()
        result = db.table(ITEM_TABLE).insert(row).execute()
        inserted = result.data[0]
    _debug("item_created", item_id=inserted["id"], session_id=session_id, user_id=user_id, file_name=file_name)
    _recompute_session_counters(session_id, user_id)
    return inserted


def process_item(
    item_id: str,
    user_id: str,
    session_id: str,
    image_bytes: bytes,
    filename: str,
) -> Dict[str, Any]:
    """
    Upload and AI-tag a single batch item.

    Uses the existing clothing_service pipeline so tagging, embeddings,
    and storage are all handled identically to the single-upload flow.
    Preview/cutout media generation is intentionally queued separately so
    batch uploads do not monopolize the app process while the user keeps
    browsing other pages.
    """
    from services.clothing_service import (
        upload_clothing_item,
    )

    _debug("process_item_started", item_id=item_id, session_id=session_id, user_id=user_id, filename=filename)

    # Mark item as uploaded/tagging
    _set_item_status(item_id, user_id, session_id, "tagging")

    try:
        # Delegate entirely to the existing upload/tag/embed pipeline.
        clothing_item = upload_clothing_item(
            user_id=user_id,
            image_bytes=image_bytes,
            filename=filename,
        )
        clothing_item_id = str(clothing_item.get("id", ""))
        image_url        = clothing_item.get("image_url")
        thumbnail_url    = clothing_item.get("thumbnail_url")
        cutout_url       = clothing_item.get("cutout_url")

        # Stamp batch-specific metadata that the general upload pipeline
        # doesn't set (these columns only exist for batch ingestion).
        _update_clothing_verification(clothing_item_id, user_id, "pending")
        _update_clothing_ingestion_source(clothing_item_id, user_id, "batch_upload")

        extra: Dict[str, Any] = {
            "clothing_item_id": clothing_item_id,
            "image_url":        image_url,
            "thumbnail_url":    thumbnail_url,
            "cutout_url":       cutout_url,
        }
        result = _set_item_status(item_id, user_id, session_id, "awaiting_verification", extra)
        _debug(
            "process_item_succeeded",
            item_id=item_id,
            session_id=session_id,
            clothing_item_id=clothing_item_id,
            has_thumbnail=bool(thumbnail_url),
            has_cutout=bool(cutout_url),
        )
        return result or {}

    except Exception as exc:
        logger.exception("[BatchUpload][Service] process_item_failed item_id=%s session_id=%s error=%s", item_id, session_id, exc)
        _set_item_status(
            item_id, user_id, session_id, "failed",
            {"error_message": str(exc)[:512]},
        )
        return {}


def process_item_media_for_batch_item(
    *,
    item_id: str,
    clothing_item_id: str,
    user_id: str,
    session_id: str,
    image_bytes: bytes,
) -> Optional[Dict[str, Any]]:
    """
    Generate wardrobe preview media after the batch item has already been
    tagged and made available for review.

    This keeps batch ingestion responsive: the user can move around the app
    while thumbnails/cutouts finish later in the same background queue.
    """
    from services.clothing_service import (
        get_user_items_by_ids,
        process_item_media,
        update_media_status,
    )

    _debug(
        "process_item_media_started",
        item_id=item_id,
        clothing_item_id=clothing_item_id,
        session_id=session_id,
        user_id=user_id,
    )

    try:
        update_media_status(clothing_item_id, user_id, "processing", stage="queued", error=None)
        process_item_media(clothing_item_id, user_id, image_bytes)

        refreshed_items = get_user_items_by_ids(user_id, [clothing_item_id], include_unverified=True)
        if not refreshed_items:
            update_media_status(
                clothing_item_id,
                user_id,
                "failed",
                stage="complete",
                error="Preview generation did not return an updated item.",
            )
            _debug(
                "process_item_media_missing_refresh",
                item_id=item_id,
                clothing_item_id=clothing_item_id,
                session_id=session_id,
            )
            return None

        refreshed = refreshed_items[0]
        refreshed_media_status = refreshed.get("media_status")
        refreshed_thumbnail = refreshed.get("thumbnail_url")
        refreshed_cutout = refreshed.get("cutout_url")

        if refreshed_media_status != "ready" or (not refreshed_thumbnail and not refreshed_cutout):
            error_message = "Preview generation did not complete successfully."
            update_media_status(
                clothing_item_id,
                user_id,
                "failed",
                stage="complete",
                error=error_message,
            )
            refreshed_items = get_user_items_by_ids(user_id, [clothing_item_id], include_unverified=True)
            if refreshed_items:
                refreshed = refreshed_items[0]
                refreshed_thumbnail = refreshed.get("thumbnail_url")
                refreshed_cutout = refreshed.get("cutout_url")
            _debug(
                "process_item_media_incomplete",
                item_id=item_id,
                clothing_item_id=clothing_item_id,
                session_id=session_id,
                media_status=refreshed_media_status,
                has_thumbnail=bool(refreshed_thumbnail),
                has_cutout=bool(refreshed_cutout),
            )

        result = _set_item_status(
            item_id,
            user_id,
            session_id,
            "awaiting_verification",
            {
                "thumbnail_url": refreshed_thumbnail,
                "cutout_url": refreshed_cutout,
            },
        )
        _debug(
            "process_item_media_finished",
            item_id=item_id,
            clothing_item_id=clothing_item_id,
            session_id=session_id,
            media_status=refreshed.get("media_status"),
            has_thumbnail=bool(refreshed_thumbnail),
            has_cutout=bool(refreshed_cutout),
        )
        return result
    except Exception as exc:
        logger.exception(
            "[BatchUpload][Service] process_item_media_for_batch_item_failed item_id=%s clothing_item_id=%s session_id=%s error=%s",
            item_id,
            clothing_item_id,
            session_id,
            exc,
        )
        return None


def verify_item(item_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """
    Mark a batch item as verified.
    Also sets verification_status='verified' on the linked clothing item.
    """
    item = _get_item(item_id, user_id)
    if not item:
        return None

    session_id = item.get("session_id", "")
    clothing_item_id = item.get("clothing_item_id")

    # Update the clothing item's verification status
    if clothing_item_id:
        _update_clothing_verification(str(clothing_item_id), user_id, "verified")

    now = _now()
    result = _set_item_status(
        item_id, user_id, session_id, "verified",
        {"verified_at": now},
    )
    _debug("item_verified", item_id=item_id, session_id=session_id, user_id=user_id, clothing_item_id=clothing_item_id)
    return result


def reject_item(item_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """
    Mark a batch item as rejected.
    Also removes the linked clothing item from the active wardrobe so rejecting
    a batch result behaves like "discard this upload".
    """
    from services.clothing_service import delete_item

    item = _get_item(item_id, user_id)
    if not item:
        return None

    session_id = item.get("session_id", "")
    clothing_item_id = item.get("clothing_item_id")

    if clothing_item_id:
        deleted = delete_item(str(clothing_item_id), user_id)
        _debug(
            "clothing_item_rejected_from_batch",
            clothing_item_id=clothing_item_id,
            user_id=user_id,
            deleted=deleted,
        )
        if not deleted:
            raise RuntimeError("Could not remove rejected item from wardrobe.")

    result = _set_item_status(item_id, user_id, session_id, "rejected")
    _debug("item_rejected", item_id=item_id, session_id=session_id, user_id=user_id, clothing_item_id=clothing_item_id)
    return result


def get_session(session_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """Return session dict with nested items list, or None if not found."""
    if _use_mock():
        session = _mock_select_one(SESSION_TABLE, {"id": session_id, "user_id": user_id})
        if not session:
            return None
        items = _mock_select_all(ITEM_TABLE, {"session_id": session_id, "user_id": user_id})
    else:
        from utils.db import get_supabase
        db = get_supabase()
        session_rows = (
            db.table(SESSION_TABLE)
            .select("*")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .execute()
            .data
        )
        if not session_rows:
            return None
        session = session_rows[0]
        items = (
            db.table(ITEM_TABLE)
            .select("*")
            .eq("session_id", session_id)
            .eq("user_id", user_id)
            .order("created_at")
            .execute()
            .data
        ) or []

    return {**session, "items": items}


def list_sessions(user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Return recent sessions for a user, newest first, without nested items."""
    if _use_mock():
        rows = _mock_select_all(SESSION_TABLE, {"user_id": user_id})
        rows.sort(key=lambda r: r.get("created_at", ""), reverse=True)
        return rows[:limit]
    from utils.db import get_supabase
    db = get_supabase()
    return (
        db.table(SESSION_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    ) or []


# ─── Internal helpers ─────────────────────────────────────────────────────────

def _get_item(item_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    if _use_mock():
        return _mock_select_one(ITEM_TABLE, {"id": item_id, "user_id": user_id})
    from utils.db import get_supabase
    db = get_supabase()
    rows = (
        db.table(ITEM_TABLE)
        .select("*")
        .eq("id", item_id)
        .eq("user_id", user_id)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _update_clothing_verification(clothing_item_id: str, user_id: str, status: str) -> None:
    """Set verification_status on the associated clothing_items row."""
    updates = {"verification_status": status, "updated_at": _now()}
    if _use_mock():
        from utils.mock_db_store import update
        update(CLOTHING_TABLE, clothing_item_id, updates, extra_filters={"user_id": user_id})
    else:
        from utils.db import get_supabase
        db = get_supabase()
        db.table(CLOTHING_TABLE).update(updates).eq("id", clothing_item_id).eq("user_id", user_id).execute()
    _debug("clothing_verification_updated", clothing_item_id=clothing_item_id, user_id=user_id, status=status)


def _update_clothing_ingestion_source(clothing_item_id: str, user_id: str, source: str) -> None:
    """Set ingestion_source on the associated clothing_items row."""
    updates = {"ingestion_source": source, "updated_at": _now()}
    if _use_mock():
        from utils.mock_db_store import update
        update(CLOTHING_TABLE, clothing_item_id, updates, extra_filters={"user_id": user_id})
    else:
        from utils.db import get_supabase
        db = get_supabase()
        db.table(CLOTHING_TABLE).update(updates).eq("id", clothing_item_id).eq("user_id", user_id).execute()
    _debug("clothing_ingestion_source_updated", clothing_item_id=clothing_item_id, user_id=user_id, source=source)
