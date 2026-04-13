"""
routers/recommendations.py — Outfit generation endpoint
POST /recommend/generate-outfits
POST /recommend/reset-feedback
"""

import math
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set
from fastapi import APIRouter, Depends, HTTPException
from models.schemas import GenerateOutfitsRequest, ResetFeedbackRequest
from services.clothing_service import get_user_items
from services.event_service import get_event
from services.recommender import compute_look_title, generate_outfit_suggestions, wardrobe_coverage_gaps
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

# Bayesian prior strength for attribute preference averaging.
# Equivalent to "assume 4 neutral (0.5) observations" before any real data.
# At n=2 ratings: score is pulled ~57% toward 0.5. At n=10: ~67% trust.
ATTRIBUTE_PRIOR_STRENGTH: int = 4

# Half-life for time decay on attribute preference weights (days).
# exp(-0.693 * days_ago / 30) → rating from 30 days ago counts at 50%.
ATTRIBUTE_DECAY_HALFLIFE_DAYS: int = 30

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


def _load_existing_combo_ratings(event_id: str, user_id: str) -> Dict[str, int]:
    """
    Return exact-combo ratings already recorded for this event.

    Keys are stable combo keys built from item_ids + accessory_ids, so if the
    same look reappears in a regenerated batch it can inherit its prior rating.
    """
    settings = get_settings()
    combo_ratings: Dict[str, int] = {}

    if settings.use_mock_auth:
        from utils.mock_db_store import select_all

        rows = select_all(TABLE, {"user_id": user_id, "event_id": event_id})
        for row in rows:
            rating = row.get("user_rating")
            if rating is None:
                continue
            all_ids = list(row.get("item_ids") or []) + list(row.get("accessory_ids") or [])
            combo_key = "|".join(sorted(str(i) for i in all_ids))
            if combo_key:
                combo_ratings[combo_key] = rating
        return combo_ratings

    from utils.db import get_supabase

    result = (
        get_supabase().table(TABLE)
        .select("item_ids, accessory_ids, user_rating")
        .eq("user_id", user_id)
        .eq("event_id", event_id)
        .not_.is_("user_rating", "null")
        .execute()
    )
    for row in (result.data or []):
        rating = row.get("user_rating")
        if rating is None:
            continue
        all_ids = list(row.get("item_ids") or []) + list(row.get("accessory_ids") or [])
        combo_key = "|".join(sorted(str(i) for i in all_ids))
        if combo_key:
            combo_ratings[combo_key] = rating
    return combo_ratings


def _combo_key_for_suggestion(suggestion: Dict) -> str:
    all_ids = list(suggestion.get("item_ids") or []) + list(suggestion.get("accessory_ids") or [])
    return "|".join(sorted(str(i) for i in all_ids))


def _dedupe_suggestions_by_combo(suggestions: List[Dict]) -> List[Dict]:
    """Keep the first suggestion for each exact item/accessory combo key."""
    deduped: List[Dict] = []
    seen: Set[str] = set()
    for suggestion in suggestions:
        combo_key = _combo_key_for_suggestion(suggestion)
        if not combo_key or combo_key in seen:
            continue
        seen.add(combo_key)
        deduped.append(suggestion)
    return deduped


# ─────────────────────────────────────────────────────────────────────────────
# Attribute preference aggregation & user style centroid
# ─────────────────────────────────────────────────────────────────────────────

def _compute_attribute_preferences(
    user_id: str,
    current_occasion: Optional[Dict] = None,
) -> Dict[str, Dict[str, float]]:
    """
    Build a per-user attribute preference vector from all rated suggestion cards.

    For each rated suggestion that has a card JSON, extracts:
        vibe, color_theory, fit_check, trend_label

    Each rating contributes a weight that is the product of three factors:
      1. Base weight     — RATING_TO_WEIGHT[rating] (star quality signal)
      2. Time decay      — exp(-0.693 * days_ago / half_life) anchored to the
                           user's most recent rating. half_life is adaptive:
                           max(30d, span_of_rating_history / 2), capped at 365d.
                           Infrequent users get a longer half-life so old-but-valid
                           ratings aren't discarded just because of a long gap.
      3. Occasion weight — _occasion_similarity(current_occasion, historical_event).
                           When current_occasion is provided, ratings from unrelated
                           occasion types are skipped (sim=0 → continue).
                           This prevents beach-casual 5★s from biasing formal scoring.

    Final per-value score uses Bayesian averaging with ATTRIBUTE_PRIOR_STRENGTH=4
    neutral observations (each worth 0.5) prepended to the weighted list. This
    graduates confidence: few ratings → pulled toward neutral; many ratings →
    trust the data.

    Returns {} when fewer than 3 rated cards survive filtering.

    Example return value:
        {
          "vibe":         {"Elegant + Confident": 0.82, "Off-Duty + Effortless": 0.52},
          "color_theory": {"Analogous": 0.87, "Neutral Base + Pop": 0.61},
          "fit_check":    {"Tailored": 0.79, "Relaxed": 0.53},
          "trend_label":  {"Trendy": 0.71, "Classic": 0.62},
        }
    """
    settings = get_settings()
    rated_cards: list = []
    events_map: Dict[str, dict] = {}

    if settings.use_mock_auth:
        from utils.mock_db_store import select_all
        all_s = select_all(TABLE, {"user_id": user_id})
        rated_cards = [
            s for s in all_s
            if s.get("user_rating") is not None and s.get("card")
        ]
        if current_occasion:
            all_e = select_all(EVENTS_TABLE, {"user_id": user_id})
            events_map = {str(e["id"]): e for e in all_e}
    else:
        from utils.db import get_supabase
        db = get_supabase()
        result = (
            db.table(TABLE)
            .select("user_rating, card, generated_at, event_id")
            .eq("user_id", user_id)
            .not_.is_("user_rating", "null")
            .not_.is_("card", "null")
            .execute()
        )
        rated_cards = result.data or []
        if current_occasion and rated_cards:
            event_ids = list({str(s["event_id"]) for s in rated_cards if s.get("event_id")})
            if event_ids:
                evts = (
                    db.table(EVENTS_TABLE)
                    .select("id, occasion_type, formality_level, temperature_context, event_tokens")
                    .in_("id", event_ids)
                    .execute()
                )
                events_map = {str(e["id"]): e for e in (evts.data or [])}

    # Anchor time decay to the user's most recent rating, not wall-clock now.
    # This prevents preferences from being artificially diluted when the user
    # takes a long break — only relative age within their own history matters.
    def _parse_ts(s: dict) -> Optional[datetime]:
        raw = s.get("generated_at")
        if not raw:
            return None
        if isinstance(raw, str):
            raw = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if raw.tzinfo is None:
            raw = raw.replace(tzinfo=timezone.utc)
        return raw

    most_recent_ts: Optional[datetime] = None
    oldest_ts: Optional[datetime] = None
    for s in rated_cards:
        ts = _parse_ts(s)
        if ts:
            if most_recent_ts is None or ts > most_recent_ts:
                most_recent_ts = ts
            if oldest_ts is None or ts < oldest_ts:
                oldest_ts = ts
    # Fall back to now only if no timestamps exist at all (shouldn't happen in prod)
    decay_anchor = most_recent_ts or datetime.now(timezone.utc)

    # Adaptive half-life: scale to the user's own rating cadence.
    # A user whose ratings span 6 months gets half_life=90d; one who rates
    # over 7 days still gets the 30d floor so rapid-fire sessions don't collapse.
    if most_recent_ts and oldest_ts:
        span_days = max(1, (most_recent_ts - oldest_ts).days)
        half_life = max(ATTRIBUTE_DECAY_HALFLIFE_DAYS, min(365, span_days // 2))
    else:
        half_life = ATTRIBUTE_DECAY_HALFLIFE_DAYS

    # Accumulate per-attribute-value weighted lists
    accum: Dict[str, Dict[str, List[float]]] = {
        "vibe": {}, "color_theory": {}, "fit_check": {}, "trend_label": {},
    }
    surviving = 0
    for s in rated_cards:
        rating = s.get("user_rating")
        card   = s.get("card") or {}

        # ── Occasion filter (skip entirely if occasion_type doesn't match) ──
        occ_weight = 1.0
        if current_occasion:
            hist_event = events_map.get(str(s.get("event_id", "")), {})
            occ_sim = _occasion_similarity(current_occasion, hist_event)
            if occ_sim <= 0:
                continue  # different occasion type — not relevant
            occ_weight = occ_sim

        # ── Time decay (relative to user's most recent rating, adaptive half-life) ──
        ts = _parse_ts(s)
        if ts:
            days_ago = max(0, (decay_anchor - ts).days)
            time_weight = math.exp(-0.693 * days_ago / half_life)
        else:
            time_weight = 1.0

        # ── Combined weight ─────────────────────────────────────────────────
        base_weight  = RATING_TO_WEIGHT.get(int(rating), 0.50)
        final_weight = base_weight * time_weight * occ_weight

        surviving += 1
        for attr in accum:
            val = card.get(attr)
            if val and isinstance(val, str):
                accum[attr].setdefault(val, []).append(final_weight)

    if surviving < 3:
        return {}

    # Bayesian averaging: prepend ATTRIBUTE_PRIOR_STRENGTH neutral (0.5) pseudo-observations.
    # Result for n real observations: (prior_strength*0.5 + sum(weights)) / (prior_strength + n)
    # At n=2: ~57% pulled toward 0.5.  At n=10: only ~29% influence from prior.
    prefs: Dict[str, Dict[str, float]] = {}
    for attr, val_map in accum.items():
        filtered: Dict[str, float] = {}
        for val, ws in val_map.items():
            if len(ws) < 2:
                continue  # single observation — insufficient signal
            n = len(ws)
            bayesian_score = (ATTRIBUTE_PRIOR_STRENGTH * 0.5 + sum(ws)) / (ATTRIBUTE_PRIOR_STRENGTH + n)
            filtered[val] = round(bayesian_score, 4)
        if filtered:
            prefs[attr] = filtered

    return prefs


def _compute_user_style_centroid(
    user_id: str,
    item_by_id: Dict[str, Dict],
) -> Optional[List[float]]:
    """
    Compute the mean CLIP embedding of items from the user's 4–5 star outfits.

    This gives a vector representation of the user's preferred visual aesthetic
    in CLIP space.  Candidate outfits are scored by cosine similarity to this
    centroid in score_user_style_centroid().

    Returns None when fewer than 3 qualifying rated suggestions exist or when
    no embedding vectors are available.
    """
    settings = get_settings()
    high_rated: list = []

    if settings.use_mock_auth:
        from utils.mock_db_store import select_all
        all_s = select_all(TABLE, {"user_id": user_id})
        high_rated = [
            s for s in all_s
            if (s.get("user_rating") or 0) >= 4
        ]
    else:
        from utils.db import get_supabase
        result = (
            get_supabase().table(TABLE)
            .select("item_ids, accessory_ids")
            .eq("user_id", user_id)
            .gte("user_rating", 4)
            .execute()
        )
        high_rated = result.data or []

    if len(high_rated) < 3:
        return None

    # Collect all CLIP vectors from items in highly-rated outfits
    all_vecs: List[List[float]] = []
    for s in high_rated:
        ids = list(s.get("item_ids") or []) + list(s.get("accessory_ids") or [])
        for iid in ids:
            item = item_by_id.get(str(iid))
            vec  = item.get("embedding_vector") if item else None
            if vec:
                all_vecs.append(vec)

    if not all_vecs:
        return None

    dim      = len(all_vecs[0])
    centroid = [sum(v[d] for v in all_vecs) / len(all_vecs) for d in range(dim)]
    return centroid


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
                .select("body_type, height_cm, style_preferences, complexion, face_shape")
                .eq("id", user_id)
                .single()
                .execute()
            )
            return result.data or {}
    except Exception:
        return {}


def _build_style_direction(
    anchor_item: dict,
    event: dict,
    user_profile: dict,
    wardrobe_items: list,
) -> dict:
    """Call LLM to generate editorial outfit options built around the anchor item."""
    from ml.llm import generate_style_direction
    return generate_style_direction(
        anchor_item=anchor_item,
        event=event,
        user_profile=user_profile,
        wardrobe_items=wardrobe_items,
    )


def _pick_style_direction_anchor(suggestions: list, item_by_id: dict) -> Optional[dict]:
    if not suggestions:
        return None

    first = suggestions[0]
    core_items = [
        item_by_id.get(str(item_id))
        for item_id in first.get("item_ids", [])
    ]
    core_items = [item for item in core_items if item]
    if not core_items:
        return None

    preferred_order = ["dresses", "tops", "set", "outerwear", "bottoms", "shoes"]
    for category in preferred_order:
        match = next((item for item in core_items if str(item.get("category")) == category), None)
        if match:
            return match
    return core_items[0]


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
    item_by_id   = {str(i.get("id")): i for i in items}

    if not items:
        raise HTTPException(
            status_code=400,
            detail="No clothing items found. Upload some items first."
        )

    anchor_item = None
    if payload.anchor_item_id:
        anchor_item = item_by_id.get(str(payload.anchor_item_id))
        if not anchor_item:
            raise HTTPException(status_code=404, detail="Anchor item not found")

    # ── Step 5b: attribute preferences + CLIP style centroid ──────────────
    # Runs concurrently with generation; both default gracefully to neutral
    # when insufficient rating history exists (< 3 rated cards).
    attribute_prefs = _compute_attribute_preferences(user_id, current_occasion=event)
    style_centroid  = _compute_user_style_centroid(user_id, item_by_id)

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
        attribute_prefs=attribute_prefs,
        user_style_centroid=style_centroid,
        anchor_item_id=str(payload.anchor_item_id) if payload.anchor_item_id else None,
    )

    if not suggestions and not anchor_item:
        raise HTTPException(
            status_code=400,
            detail="Could not generate outfits. You may need more items (try uploading a top, bottom, and shoes)."
        )

    if not suggestions and anchor_item:
        coverage_hints = wardrobe_coverage_gaps(items)
        return {
            "event":           event,
            "suggestions":     [],
            "all_seen":        all_seen,
            "coverage_hints":  coverage_hints,
            "status":          "text_only",
            "style_direction": style_direction,
            "missing_items":   coverage_hints,
            "anchor_item":     anchor_item,
        }

    existing_combo_ratings = _load_existing_combo_ratings(str(payload.event_id), user_id)
    for suggestion in suggestions:
        combo_key = _combo_key_for_suggestion(suggestion)
        if combo_key and suggestion.get("user_rating") is None:
            existing_rating = existing_combo_ratings.get(combo_key)
            if existing_rating is not None:
                suggestion["user_rating"] = existing_rating

    suggestions = _dedupe_suggestions_by_combo(suggestions)

    style_direction_anchor = anchor_item or _pick_style_direction_anchor(suggestions, item_by_id)
    style_direction = (
        _build_style_direction(style_direction_anchor, event, user_profile, items)
        if style_direction_anchor else None
    )

    # ── Step 7-8: persist + return ─────────────────────────────────────────
    # Strip score_breakdown (not a DB column) before persisting.
    # card is persisted as a jsonb column; explanation holds the short verdict.
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
        "coverage_hints":  coverage_hints,   # [] when wardrobe is sufficient
        "status":          "moodboard" if anchor_item else None,
        "style_direction": style_direction,
        "missing_items":   None,
        "anchor_item":     anchor_item,
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


def _enrich_suggestions(rows: list, event: dict, item_by_id: Dict[str, dict]) -> list:
    """
    Back-fill `look_title` on stored cards that predate the field.
    Uses the full _look_title() path (via compute_look_title) so titles are
    derived from actual item colors + occasion tokens — same varied output as
    freshly generated cards, not a simplified card-only approximation.
    """
    for row in rows:
        card = row.get("card")
        if not (card and isinstance(card, dict) and not card.get("look_title")):
            continue
        item_ids = list(row.get("item_ids") or []) + list(row.get("accessory_ids") or [])
        items = [item_by_id[str(iid)] for iid in item_ids if str(iid) in item_by_id]
        card["look_title"] = compute_look_title(
            items,
            event,
            card.get("fit_check") or "",
            card.get("color_theory") or "",
        )
    return rows


@router.get("/suggestions/{event_id}")
def get_suggestions(event_id: str, user_id: str = Depends(get_current_user_id)):
    """Fetch previously generated outfit suggestions for an event."""
    event      = get_event(event_id, user_id) or {}
    items      = get_user_items(user_id)
    item_by_id = {str(i.get("id")): i for i in items}

    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import select_all
        rows = select_all(TABLE, {"event_id": event_id, "user_id": user_id})
    else:
        from utils.db import get_supabase
        rows = (
            get_supabase().table(TABLE)
            .select("*")
            .eq("event_id", event_id)
            .eq("user_id", user_id)
            .execute()
            .data
        ) or []

    def _generated_at_key(row: dict):
        value = row.get("generated_at")
        if not value:
            return datetime.min.replace(tzinfo=timezone.utc)
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except Exception:
            return datetime.min.replace(tzinfo=timezone.utc)

    rows = sorted(rows, key=_generated_at_key, reverse=True)

    return _dedupe_suggestions_by_combo(_enrich_suggestions(rows, event, item_by_id))
