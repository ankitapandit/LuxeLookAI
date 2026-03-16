"""
routers/events.py — Event creation endpoint
POST /events/create-event
"""

from fastapi import APIRouter, Depends
from models.schemas import EventCreate, Event
from services.event_service import create_event
from utils.auth import get_current_user_id

router = APIRouter()


@router.post("/create-event", status_code=201)
def create_event_route(
    payload: EventCreate,
    user_id: str = Depends(get_current_user_id),
):
    """
    Accept a free-text occasion description, parse it via LLM,
    and persist the structured event. Returns the full event row.
    """
    return create_event(user_id=user_id, raw_text=payload.raw_text)
