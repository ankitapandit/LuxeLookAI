"""
routers/batch_upload.py — Batch wardrobe upload endpoints
==========================================================
POST   /batch-upload/session                          create session
POST   /batch-upload/session/{session_id}/items       upload + process one image
GET    /batch-upload/session/{session_id}             session detail + items
GET    /batch-upload/sessions                         list recent sessions
POST   /batch-upload/items/{item_id}/verify           mark item verified
POST   /batch-upload/items/{item_id}/reject           mark item rejected
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from models.schemas import (
    BatchSession, BatchSessionWithItems,
    BatchItem,
    CreateBatchSessionRequest,
    VerifyBatchItemResponse,
    RejectBatchItemResponse,
)
from services import batch_upload_service as svc
from utils.auth import get_current_user_id

router = APIRouter()
logger = logging.getLogger(__name__)
# Keep batch work serialized so background AI/media processing does not crowd
# the rest of the app while the user keeps browsing.
BATCH_PROCESSING_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="batch-upload")

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _require_session(session_id: str, user_id: str) -> dict:
    session = svc.get_session(session_id, user_id)
    if not session:
        raise HTTPException(status_code=404, detail="Batch session not found")
    return session


def _run_batch_item_processing(
    *,
    session_id: str,
    item_id: str,
    user_id: str,
    image_bytes: bytes,
    filename: str,
) -> None:
    logger.info("[BatchUpload][Router] background_process_started session_id=%r item_id=%r", session_id, item_id)
    try:
        result = svc.process_item(
            item_id=item_id,
            user_id=user_id,
            session_id=session_id,
            image_bytes=image_bytes,
            filename=filename,
        )
        clothing_item_id = str((result or {}).get("clothing_item_id") or "")
        if clothing_item_id:
            logger.info(
                "[BatchUpload][Router] background_media_queued session_id=%r item_id=%r clothing_item_id=%r",
                session_id,
                item_id,
                clothing_item_id,
            )
            BATCH_PROCESSING_EXECUTOR.submit(
                _run_batch_item_media_processing,
                session_id=session_id,
                item_id=item_id,
                clothing_item_id=clothing_item_id,
                user_id=user_id,
                image_bytes=image_bytes,
            )
    except Exception:
        logger.exception("[BatchUpload][Router] background_process_crashed session_id=%r item_id=%r", session_id, item_id)
    finally:
        logger.info("[BatchUpload][Router] background_process_finished session_id=%r item_id=%r", session_id, item_id)


def _run_batch_item_media_processing(
    *,
    session_id: str,
    item_id: str,
    clothing_item_id: str,
    user_id: str,
    image_bytes: bytes,
) -> None:
    logger.info(
        "[BatchUpload][Router] background_media_started session_id=%r item_id=%r clothing_item_id=%r",
        session_id,
        item_id,
        clothing_item_id,
    )
    try:
        svc.process_item_media_for_batch_item(
            item_id=item_id,
            clothing_item_id=clothing_item_id,
            user_id=user_id,
            session_id=session_id,
            image_bytes=image_bytes,
        )
    except Exception:
        logger.exception(
            "[BatchUpload][Router] background_media_crashed session_id=%r item_id=%r clothing_item_id=%r",
            session_id,
            item_id,
            clothing_item_id,
        )
    finally:
        logger.info(
            "[BatchUpload][Router] background_media_finished session_id=%r item_id=%r clothing_item_id=%r",
            session_id,
            item_id,
            clothing_item_id,
        )


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/session", response_model=BatchSession, status_code=201)
def create_session(
    payload: CreateBatchSessionRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Create a new batch upload session.  Call this once before uploading any
    individual images.  ``total_count`` must be between 1 and 5.
    """
    logger.info("[BatchUpload][Router] create_session user_id=%r total_count=%r", user_id, payload.total_count)
    session = svc.create_session(user_id=user_id, total_count=payload.total_count)
    return session


@router.post("/session/{session_id}/items", response_model=BatchItem, status_code=202)
async def upload_session_item(
    session_id: str,
    file: UploadFile = File(..., description="Clothing image"),
    user_id: str = Depends(get_current_user_id),
):
    """
    Upload one image into an existing batch session.  The image is saved and
    AI-tagged in a background thread so the HTTP response returns quickly
    with status='tagging'.  Poll GET /batch-upload/session/{session_id} to
    track when it transitions to awaiting_verification or failed.
    """
    # Validate session belongs to user
    session = svc.get_session(session_id, user_id)
    if not session:
        raise HTTPException(status_code=404, detail="Batch session not found")

    # Guard: already at or over total_count
    existing_items = session.get("items", [])
    if len(existing_items) >= session.get("total_count", 5):
        raise HTTPException(status_code=400, detail="Session item limit reached")

    image_bytes = await file.read()
    filename = file.filename or "image.jpg"
    logger.info(
        "[BatchUpload][Router] upload_session_item session_id=%r user_id=%r filename=%r bytes=%r",
        session_id,
        user_id,
        filename,
        len(image_bytes),
    )

    # Create queued item row
    item = svc.create_item(
        session_id=session_id,
        user_id=user_id,
        file_name=filename,
    )
    item_id = str(item["id"])

    # Queue onto a bounded executor so batch uploads do not monopolize the app server.
    BATCH_PROCESSING_EXECUTOR.submit(
        _run_batch_item_processing,
        session_id=session_id,
        item_id=item_id,
        user_id=user_id,
        image_bytes=image_bytes,
        filename=filename,
    )

    return item


@router.get("/session/{session_id}", response_model=BatchSessionWithItems)
def get_session(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Return session summary + all item rows.  Poll this to track progress."""
    return _require_session(session_id, user_id)


@router.get("/sessions", response_model=List[BatchSession])
def list_sessions(
    limit: int = 20,
    user_id: str = Depends(get_current_user_id),
):
    """Return the user's recent batch sessions (newest first), without item detail."""
    return svc.list_sessions(user_id=user_id, limit=min(limit, 50))


@router.post("/items/{item_id}/verify", response_model=VerifyBatchItemResponse)
def verify_item(
    item_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Mark a batch item as verified.  Sets the linked clothing item's
    ``verification_status`` to 'verified' so it participates in outfit
    suggestions.
    """
    logger.info("[BatchUpload][Router] verify_item item_id=%r user_id=%r", item_id, user_id)
    result = svc.verify_item(item_id=item_id, user_id=user_id)
    if not result:
        raise HTTPException(status_code=404, detail="Batch item not found")
    return VerifyBatchItemResponse(
        item_id=result["id"],
        status=result["status"],
        clothing_item_id=result.get("clothing_item_id"),
    )


@router.post("/items/{item_id}/reject", response_model=RejectBatchItemResponse)
def reject_item(
    item_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Mark a batch item as rejected and remove its linked clothing item from the
    active wardrobe.
    """
    logger.info("[BatchUpload][Router] reject_item item_id=%r user_id=%r", item_id, user_id)
    try:
        result = svc.reject_item(item_id=item_id, user_id=user_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not result:
        raise HTTPException(status_code=404, detail="Batch item not found")
    return RejectBatchItemResponse(
        item_id=result["id"],
        status=result["status"],
    )
