"""
routers/recommendations.py — Outfit generation endpoint
POST /recommend/generate-outfits
"""

from fastapi import APIRouter, Depends, HTTPException
from models.schemas import GenerateOutfitsRequest
from services.clothing_service import get_user_items
from services.event_service import get_event
from services.recommender import generate_outfit_suggestions
from utils.auth import get_current_user_id
from config import get_settings

router = APIRouter()
TABLE = "outfit_suggestions"


def _persist_suggestions(suggestions: list):
    """Save outfit suggestions — mock or real depending on config."""
    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import insert_many
        insert_many(TABLE, suggestions)
    else:
        from utils.db import get_supabase
        get_supabase().table(TABLE).insert(suggestions).execute()


@router.post("/generate-outfits")
def generate_outfits(
    payload: GenerateOutfitsRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Generate ranked outfit suggestions for a given event.

    Pipeline:
      1. Load the event (validates ownership)
      2. Load all user's wardrobe items
      3. Run recommendation engine
      4. Persist suggestions to DB
      5. Return event + suggestions
    """
    # ── Load event ────────────────────────────────────────────────────────
    event = get_event(str(payload.event_id), user_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # ── Load wardrobe ─────────────────────────────────────────────────────
    items = get_user_items(user_id)
    if not items:
        raise HTTPException(
            status_code=400,
            detail="No clothing items found. Upload some items first."
        )

    # ── Generate suggestions ──────────────────────────────────────────────
    suggestions = generate_outfit_suggestions(
        user_items=items,
        occasion=event,
        event_id=str(payload.event_id),
        user_id=user_id,
        top_n=payload.top_n,
    )

    if not suggestions:
        raise HTTPException(
            status_code=400,
            detail="Could not generate outfits. You may need more items (try uploading a top, bottom, and shoes)."
        )

    # ── Persist suggestions ───────────────────────────────────────────────
    _persist_suggestions(suggestions)

    return {"event": event, "suggestions": suggestions}


@router.get("/suggestions/{event_id}")
def get_suggestions(event_id: str, user_id: str = Depends(get_current_user_id)):
    """Fetch previously generated outfit suggestions for an event."""
    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import select_all
        return select_all("outfit_suggestions", {"event_id": event_id, "user_id": user_id})
    else:
        from utils.db import get_supabase
        return (
            get_supabase().table("outfit_suggestions")
            .select("*")
            .eq("event_id", event_id)
            .eq("user_id", user_id)
            .execute()
            .data
        )
