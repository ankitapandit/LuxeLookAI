"""
routers/feedback.py — User outfit rating endpoint
POST /feedback/rate-outfit
"""

from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from models.schemas import (
    FeedbackRequest,
    FeedbackResponse,
    StyleDirectionFeedbackRequest,
    StyleDirectionFeedbackResponse,
)
from utils.auth import get_current_user_id
from config import get_settings

router = APIRouter()
TABLE = "outfit_suggestions"
STYLE_DIRECTION_TABLE = "style_direction_feedback"


def _update_rating(outfit_id: str, user_id: str, rating: int) -> bool:
    """Update rating — mock or real depending on config."""
    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import update
        result = update(TABLE, outfit_id, {"user_rating": rating}, extra_filters={"user_id": user_id})
        return result is not None
    else:
        from utils.db import get_supabase
        result = (
            get_supabase().table(TABLE)
            .update({"user_rating": rating})
            .eq("id", outfit_id)
            .eq("user_id", user_id)
            .execute()
        )
        return len(result.data) > 0


def _upsert_style_direction_feedback(
    *,
    event_id: str,
    option_name: str,
    feedback_value: str,
    option_snapshot: dict | None,
    user_id: str,
) -> bool:
    """Store thumbs up/down feedback for Beyond your wardrobe suggestions."""
    settings = get_settings()
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "user_id": user_id,
        "event_id": event_id,
        "option_name": option_name,
        "feedback_value": feedback_value,
        "option_snapshot": option_snapshot or {},
        "updated_at": now,
    }

    if settings.use_mock_auth:
        from utils.mock_db_store import insert, select_one, update

        existing = select_one(
            STYLE_DIRECTION_TABLE,
            {"user_id": user_id, "event_id": event_id, "option_name": option_name},
        )
        if existing:
            updated = update(
                STYLE_DIRECTION_TABLE,
                existing["id"],
                payload,
                extra_filters={"user_id": user_id},
            )
            return updated is not None

        row = {
            "id": str(uuid4()),
            "created_at": now,
            **payload,
        }
        insert(STYLE_DIRECTION_TABLE, row)
        return True

    from utils.db import get_supabase

    result = (
        get_supabase().table(STYLE_DIRECTION_TABLE)
        .upsert(
            {
                "user_id": user_id,
                "event_id": event_id,
                "option_name": option_name,
                "feedback_value": feedback_value,
                "option_snapshot": option_snapshot or {},
                "updated_at": now,
            },
            on_conflict="user_id,event_id,option_name",
        )
        .execute()
    )
    return bool(result.data)


@router.post("/rate-outfit", response_model=FeedbackResponse)
def rate_outfit(
    payload: FeedbackRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Store a user's 1–5 rating for an outfit suggestion.
    In V2, this data will feed a lightweight ranking model.
    """
    if not (1 <= payload.rating <= 5):
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")

    updated = _update_rating(str(payload.outfit_id), user_id, payload.rating)
    if not updated:
        raise HTTPException(status_code=404, detail="Outfit not found")

    return FeedbackResponse(
        outfit_id=payload.outfit_id,
        rating=payload.rating,
        message="Rating saved. Thank you for the feedback!",
    )


@router.post("/style-direction", response_model=StyleDirectionFeedbackResponse)
def rate_style_direction(
    payload: StyleDirectionFeedbackRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Store thumbs up/down feedback for AI-generated Beyond your wardrobe cards."""
    updated = _upsert_style_direction_feedback(
        event_id=str(payload.event_id),
        option_name=payload.option_name.strip(),
        feedback_value=payload.feedback_value,
        option_snapshot=payload.option_snapshot,
        user_id=user_id,
    )
    if not updated:
        raise HTTPException(status_code=500, detail="Could not save style-direction feedback")

    return StyleDirectionFeedbackResponse(
        event_id=payload.event_id,
        option_name=payload.option_name,
        feedback_value=payload.feedback_value,
        message="Feedback saved. Thank you!",
    )
