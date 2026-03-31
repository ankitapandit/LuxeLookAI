"""
routers/recommendations.py — Outfit generation endpoint
POST /recommend/generate-outfits
POST /recommend/reset-feedback
"""

from typing import Dict, List, Set
from fastapi import APIRouter, Depends, HTTPException
from models.schemas import GenerateOutfitsRequest, ResetFeedbackRequest
from services.clothing_service import get_user_items
from services.event_service import get_event
from services.recommender import generate_outfit_suggestions, wardrobe_coverage_gaps
from utils.auth import get_current_user_id
from config import get_settings

router = APIRouter()
TABLE          = "outfit_suggestions"
EVENTS_TABLE   = "events"
PROFILES_TABLE = "users"

# Rating value → preference weight used inside the scorer.
# 0 = explicit "None of these work" (user_rating=0); None = never rated (neutral, handled in scorer).
RATING_TO_WEIGHT: Dict[int, float] = {
    0: 0.10,   # explicitly marked as poor match
    1: 0.20,
    2: 0.40,
    3: 0.60,
    4: 0.80,
    5: 1.00,
}

# Token discriminative-power weights for weighted Jaccard similarity.
# Activity tokens are most discriminative (dinner vs interview are very different occasions).
_ACTIVITY_TOKENS: Set[str] = {
    "dinner", "brunch", "lunch", "breakfast", "interview", "meeting",
    "conference", "wedding", "gala", "cocktail", "party", "birthday",
    "celebration", "date", "concert", "ceremony", "reception", "bbq",
    "picnic", "workout", "gym", "hiking", "exhibition", "show",
}
_SETTING_TOKENS: Set[str] = {
    "beach", "office", "restaurant", "museum", "garden", "rooftop",
    "bar", "park", "lounge", "gallery", "hotel", "club", "outdoor", "indoor",
}


# ─────────────────────────────────────────────────────────────────────────────
# Occasion similarity helpers
# ─────────────────────────────────────────────────────────────────────────────

def _formality_band(level: float) -> str:
    if level < 0.33:  return "casual"
    if level < 0.66:  return "smart_casual"
    return "formal"


def _weighted_jaccard(tokens_a: list, tokens_b: list) -> float:
    """
    Jaccard similarity weighted by token discriminative power:
      activity tokens  → weight 3.0
      setting tokens   → weight 2.0
      other tokens     → weight 1.0
    """
    from services.taxonomy import get_event_tokens
    _act, _set = get_event_tokens()

    def _w(t: str) -> float:
        if t in _act: return 3.0
        if t in _set: return 2.0
        return 1.0

    sa, sb = set(tokens_a), set(tokens_b)
    union  = sa | sb
    if not union:
        return 0.5  # no token data — neutral
    w_inter = sum(_w(t) for t in sa & sb)
    w_union = sum(_w(t) for t in union)
    return w_inter / w_union if w_union > 0 else 0.0


def _occasion_similarity(occ_a: dict, occ_b: dict) -> float:
    """
    0–1 similarity between two occasion dicts.
    Hard-filtered by occasion_type mismatch or formality gap > 0.25.
    Soft signals: weighted token overlap (50%), formality proximity (30%),
    temperature match (20%).
    """
    if occ_a.get("occasion_type") != occ_b.get("occasion_type"):
        return 0.0

    formality_diff = abs(
        (occ_a.get("formality_level") or 0.5) - (occ_b.get("formality_level") or 0.5)
    )
    if formality_diff > 0.25:
        return 0.0

    temp_score     = 1.0 if occ_a.get("temperature_context") == occ_b.get("temperature_context") else 0.5
    formality_score = 1.0 - (formality_diff / 0.25)

    ta = list(occ_a.get("event_tokens") or [])
    tb = list(occ_b.get("event_tokens") or [])
    token_score = _weighted_jaccard(ta, tb) if (ta and tb) else 0.5

    return 0.5 * token_score + 0.3 * formality_score + 0.2 * temp_score


# ─────────────────────────────────────────────────────────────────────────────
# Feedback helpers
# ─────────────────────────────────────────────────────────────────────────────

def _mark_skipped_suggestions(suggestion_ids: List[str], user_id: str) -> None:
    """
    Mark unrated suggestions as user_rating=0 (explicit "None of these work").
    Only updates rows that are still NULL — never overwrites explicit star ratings.
    """
    if not suggestion_ids:
        return
    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import select_one, update
        for sid in suggestion_ids:
            row = select_one(TABLE, {"id": sid, "user_id": user_id})
            if row and row.get("user_rating") is None:
                update(TABLE, sid, {"user_rating": 0}, extra_filters={"user_id": user_id})
    else:
        from utils.db import get_supabase
        for sid in suggestion_ids:
            (
                get_supabase().table(TABLE)
                .update({"user_rating": 0})
                .eq("id", sid)
                .eq("user_id", user_id)
                .is_("user_rating", "null")
                .execute()
            )


def _load_combo_feedback_weights(user_id: str, occasion: dict) -> Dict[str, float]:
    """
    Build a combo reputation map scoped to the current occasion context.

    For each rated suggestion whose occasion is similar to the current one,
    compute: weight = RATING_TO_WEIGHT[rating] * occasion_similarity.

    Returns { combo_key: avg_weighted_score } where
    combo_key = "|".join(sorted item_ids + accessory_ids).
    """
    settings = get_settings()
    rated: list = []
    events_map: Dict[str, dict] = {}

    if settings.use_mock_auth:
        from utils.mock_db_store import select_all
        all_s = select_all(TABLE, {"user_id": user_id})
        rated = [s for s in all_s if s.get("user_rating") is not None]
        all_e = select_all(EVENTS_TABLE, {"user_id": user_id})
        events_map = {str(e["id"]): e for e in all_e}
    else:
        from utils.db import get_supabase
        db = get_supabase()
        result = (
            db.table(TABLE)
            .select("item_ids, accessory_ids, user_rating, event_id")
            .eq("user_id", user_id)
            .not_.is_("user_rating", "null")
            .execute()
        )
        rated = result.data or []
        event_ids = list({str(s["event_id"]) for s in rated if s.get("event_id")})
        if event_ids:
            evts = (
                db.table(EVENTS_TABLE)
                .select("id, occasion_type, formality_level, temperature_context, event_tokens")
                .in_("id", event_ids)
                .execute()
            )
            events_map = {str(e["id"]): e for e in (evts.data or [])}

    accum: Dict[str, List[float]] = {}
    for s in rated:
        hist_event = events_map.get(str(s.get("event_id", "")), {})
        sim = _occasion_similarity(occasion, hist_event)
        if sim <= 0:
            continue  # different occasion context — discard

        base_weight  = RATING_TO_WEIGHT.get(s.get("user_rating"), 0.50)
        final_weight = base_weight * sim   # scale by occasion similarity

        all_ids   = list(s.get("item_ids") or []) + list(s.get("accessory_ids") or [])
        combo_key = "|".join(sorted(str(i) for i in all_ids))
        if combo_key:
            accum.setdefault(combo_key, []).append(final_weight)

    return {k: sum(v) / len(v) for k, v in accum.items()}


def _load_seen_combos(suggestion_ids: List[str], user_id: str) -> List[List[str]]:
    """Return item_ids lists for the given suggestion IDs (for soft downranking)."""
    if not suggestion_ids:
        return []
    settings = get_settings()
    seen: List[List[str]] = []

    if settings.use_mock_auth:
        from utils.mock_db_store import select_one
        for sid in suggestion_ids:
            row = select_one(TABLE, {"id": sid, "user_id": user_id})
            if row and row.get("item_ids"):
                seen.append([str(i) for i in row["item_ids"]])
    else:
        from utils.db import get_supabase
        result = (
            get_supabase().table(TABLE)
            .select("item_ids")
            .in_("id", suggestion_ids)
            .eq("user_id", user_id)
            .execute()
        )
        for row in (result.data or []):
            if row.get("item_ids"):
                seen.append([str(i) for i in row["item_ids"]])

    return seen


# ─────────────────────────────────────────────────────────────────────────────
# Profile loader
# ─────────────────────────────────────────────────────────────────────────────

def _load_user_profile(user_id: str) -> dict:
    """Fetch user profile for body-type and preference priors."""
    settings = get_settings()
    try:
        if settings.use_mock_auth:
            from utils.mock_db_store import select_one
            return select_one(PROFILES_TABLE, {"id": user_id}) or {}
        else:
            from utils.db import get_supabase
            result = (
                get_supabase().table(PROFILES_TABLE)
                .select("body_type, height_cm, style_preferences")
                .eq("id", user_id)
                .single()
                .execute()
            )
            return result.data or {}
    except Exception:
        return {}


# ─────────────────────────────────────────────────────────────────────────────
# Persistence
# ─────────────────────────────────────────────────────────────────────────────

def _persist_suggestions(suggestions: list) -> None:
    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import insert_many
        insert_many(TABLE, suggestions)
    else:
        from utils.db import get_supabase
        get_supabase().table(TABLE).insert(suggestions).execute()


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/generate-outfits")
def generate_outfits(
    payload: GenerateOutfitsRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Generate ranked outfit suggestions for a given event.

    Pipeline:
      1.  Load the event (validates ownership)
      2a. If mark_as_bad=True  → mark unrated shown suggestions as user_rating=0
      2b. If mark_as_bad=False → no ratings written (neutral "show me more")
      3.  Build occasion-scoped combo reputation map from rating history
      4.  Load seen combos for soft downranking (accumulated across session)
      5.  Load wardrobe + user profile
      6.  Run recommendation engine
      7.  Persist new suggestions
      8.  Return event + suggestions + all_seen flag
    """
    event = get_event(str(payload.event_id), user_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    shown_ids = list(payload.previously_shown_ids or [])

    # ── Step 2: write negative signal only when user explicitly asked ──────
    if payload.mark_as_bad and shown_ids:
        _mark_skipped_suggestions(shown_ids, user_id)

    # ── Step 3-4: feedback + seen combos ──────────────────────────────────
    combo_weights = _load_combo_feedback_weights(user_id, event)
    seen_combos   = _load_seen_combos(shown_ids, user_id)

    # ── Step 5: wardrobe + profile ─────────────────────────────────────────
    items        = get_user_items(user_id)
    user_profile = _load_user_profile(user_id)

    if not items:
        raise HTTPException(
            status_code=400,
            detail="No clothing items found. Upload some items first."
        )

    # ── Step 6: generate ───────────────────────────────────────────────────
    suggestions, all_seen = generate_outfit_suggestions(
        user_items=items,
        occasion=event,
        event_id=str(payload.event_id),
        user_id=user_id,
        top_n=payload.top_n,
        user_profile=user_profile,
        combo_feedback_weights=combo_weights,
        seen_item_combos=seen_combos,
    )

    if not suggestions:
        raise HTTPException(
            status_code=400,
            detail="Could not generate outfits. You may need more items (try uploading a top, bottom, and shoes)."
        )

    # ── Step 7-8: persist + return ─────────────────────────────────────────
    # Strip score_breakdown before DB insert (not a DB column), keep for response
    suggestions_for_db = [
        {k: v for k, v in s.items() if k != "score_breakdown"}
        for s in suggestions
    ]
    _persist_suggestions(suggestions_for_db)

    coverage_hints = wardrobe_coverage_gaps(items)
    return {
        "event":          event,
        "suggestions":    suggestions,
        "all_seen":       all_seen,
        "coverage_hints": coverage_hints,   # [] when wardrobe is sufficient
    }


@router.post("/reset-feedback")
def reset_feedback(
    payload: ResetFeedbackRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Clear all outfit ratings for occasions similar to the given event
    (same occasion_type within ±0.25 formality band).
    Called when the user exhausts all combos and wants a fresh start.
    """
    event = get_event(payload.event_id, user_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    occ_type   = event.get("occasion_type")
    formality  = event.get("formality_level", 0.5)
    band_min   = max(0.0, formality - 0.25)
    band_max   = min(1.0, formality + 0.25)

    settings = get_settings()
    reset_count = 0

    if settings.use_mock_auth:
        from utils.mock_db_store import select_all, update
        similar_ids = {
            str(e["id"])
            for e in select_all(EVENTS_TABLE, {"user_id": user_id})
            if e.get("occasion_type") == occ_type
            and band_min <= (e.get("formality_level") or 0.5) <= band_max
        }
        for s in select_all(TABLE, {"user_id": user_id}):
            if str(s.get("event_id")) in similar_ids and s.get("user_rating") is not None:
                update(TABLE, s["id"], {"user_rating": None}, extra_filters={"user_id": user_id})
                reset_count += 1
    else:
        from utils.db import get_supabase
        db = get_supabase()
        evts = (
            db.table(EVENTS_TABLE)
            .select("id")
            .eq("user_id", user_id)
            .eq("occasion_type", occ_type)
            .gte("formality_level", band_min)
            .lte("formality_level", band_max)
            .execute()
        )
        similar_ids = [str(e["id"]) for e in (evts.data or [])]
        if similar_ids:
            result = (
                db.table(TABLE)
                .update({"user_rating": None})
                .in_("event_id", similar_ids)
                .eq("user_id", user_id)
                .execute()
            )
            reset_count = len(result.data or [])

    return {
        "reset_count": reset_count,
        "message": f"Feedback reset for {reset_count} outfits in this occasion context.",
    }


@router.get("/suggestions/{event_id}")
def get_suggestions(event_id: str, user_id: str = Depends(get_current_user_id)):
    """Fetch previously generated outfit suggestions for an event."""
    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import select_all
        return select_all(TABLE, {"event_id": event_id, "user_id": user_id})
    else:
        from utils.db import get_supabase
        return (
            get_supabase().table(TABLE)
            .select("*")
            .eq("event_id", event_id)
            .eq("user_id", user_id)
            .execute()
            .data
        )
