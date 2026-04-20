"""
routers/activity.py — Route-level visit logging
==============================================
Minimal first-party page visit logging for authenticated users.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from models.schemas import (
    PageVisitEndRequest,
    PageVisitEndResponse,
    PageVisitStartRequest,
    PageVisitStartResponse,
)
from services.page_visit_service import end_page_visit, start_page_visit
from utils.auth import get_current_user_id

router = APIRouter()


@router.post("/page-visits/start", response_model=PageVisitStartResponse)
def page_visit_start(
    payload: PageVisitStartRequest,
    user_id: str = Depends(get_current_user_id),
):
    session_id = str(payload.session_id or "").strip()
    page_key = str(payload.page_key or "").strip()
    if not session_id or not page_key:
        raise HTTPException(status_code=400, detail="session_id and page_key are required")

    row = start_page_visit(user_id, payload.model_dump())
    return PageVisitStartResponse(
        visit_id=str(row.get("id") or ""),
        entered_at=row.get("entered_at"),
    )


@router.post("/page-visits/end", response_model=PageVisitEndResponse)
def page_visit_end(
    payload: PageVisitEndRequest,
    user_id: str = Depends(get_current_user_id),
):
    row = end_page_visit(user_id, payload.visit_id, payload.model_dump())
    return PageVisitEndResponse(
        visit_id=str(row.get("id") or payload.visit_id),
        left_at=row.get("left_at"),
        duration_ms=row.get("duration_ms"),
    )
