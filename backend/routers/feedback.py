"""
routers/feedback.py — User outfit rating endpoint
POST /feedback/rate-outfit
"""

from fastapi import APIRouter, Depends, HTTPException
from models.schemas import FeedbackRequest, FeedbackResponse
from utils.auth import get_current_user_id
from config import get_settings

router = APIRouter()
TABLE = "outfit_suggestions"


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

