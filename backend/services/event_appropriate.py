"""
services/event_appropriate.py — Multi-dimensional event alignment scorer
=========================================================================
Replaces the single-axis appropriateness scorer with a per-dimension
breakdown that mirrors every field the user fills in the EventBriefEditor.

Dimensions (weighted):
  dress_code   — formality alignment                     0.30
  mood         — style mood / vibe match                 0.25
  time_of_day  — evening / daytime fit                   0.20
  weather      — fabric / coverage / footwear fit        0.15
  purpose      — occasion purpose fit                    0.10

Hard veto rules (applied before weighted average):
  Rule 1: dress_code score < VETO_THRESHOLD (0.40)
          → outfit eliminated regardless of other scores.
          Rationale: you cannot wear casual clothes to a cocktail event,
          no matter how good the color story is.

  Rule 2: time_of_day is explicitly specified AND time_of_day score < 0.35
          → outfit eliminated.
          Rationale: a summer halter for a rainy evening date is wrong
          even if the formality is technically correct.

Fallback logic:
  Dimensions with no event signal (e.g. no mood specified) default to
  NEUTRAL (0.50) so the scorer never punishes an outfit for a missing brief
  parameter — it only rewards or penalises known signals.

Usage from recommender.py:
  from services.event_appropriate import score_event_appropriate
  ea_score, dim_scores, ea_label = score_event_appropriate(outfit_items, occasion)
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────
VETO_THRESHOLD = 0.40   # below this → hard veto (dress_code dim only)
TIME_VETO      = 0.35   # below this → hard veto (time_of_day dim, when specified)
NEUTRAL        = 0.50   # default when a dimension has no event signal

# ── Dimension weights (must sum to 1.0) ────────────────────────────────────────
_DIM_WEIGHTS: Dict[str, float] = {
    "dress_code":  0.30,
    "mood":        0.25,
    "time_of_day": 0.20,
    "weather":     0.15,
    "purpose":     0.10,
}
assert abs(sum(_DIM_WEIGHTS.values()) - 1.0) < 1e-9, "_DIM_WEIGHTS must sum to 1.0"

# ── Fabric vocabularies ────────────────────────────────────────────────────────
_EVENING_FABRICS: Set[str] = {
    "velvet", "satin", "sequin", "sequins", "lace", "silk", "organza",
    "chantilly", "brocade", "taffeta", "metallic", "lamé", "crepe",
    "duchess satin", "charmeuse",
}
_DAYTIME_FABRICS: Set[str] = {
    "linen", "cotton", "denim", "chambray", "jersey", "terry cloth",
    "flannel", "corduroy", "twill", "poplin", "canvas", "chambray",
}
_HEAVY_FABRICS: Set[str] = {
    "wool", "cashmere", "fleece", "knit", "waffle-knit", "sherpa",
    "faux-fur", "faux fur", "tweed", "leather", "suede", "shearling",
}
_BREATHABLE_FABRICS: Set[str] = {
    "linen", "cotton", "chiffon", "bamboo", "rayon", "silk", "satin",
    "muslin", "georgette",
}
_DELICATE_FABRICS: Set[str] = {
    "silk", "chiffon", "organza", "lace", "satin", "charmeuse",
}

# ── Color groups ───────────────────────────────────────────────────────────────
_NEUTRAL_COLORS: Set[str] = {
    "black", "white", "beige", "cream", "ivory", "grey", "gray",
    "nude", "camel", "tan", "khaki", "charcoal", "silver",
}
_DARK_RICH_COLORS: Set[str] = {
    "black", "navy", "burgundy", "forest green", "emerald", "plum",
    "charcoal", "chocolate", "midnight", "deep red", "oxblood",
}
_ROMANTIC_COLORS: Set[str] = {
    "blush", "pink", "rose", "cream", "ivory", "white", "lavender",
    "lilac", "dusty rose", "mauve", "champagne", "red", "soft pink",
}
_BOLD_COLORS: Set[str] = {
    "red", "cobalt", "yellow", "mustard", "orange", "coral",
    "fuchsia", "lime", "hot pink", "neon", "electric blue",
}

# Colors that unambiguously read as daytime / tropical / summery.
# Restricted to neons and lime/chartreuse family — colors that are NEVER
# appropriate for evening dressing regardless of styling.
# Bold-but-wearable evening colors (coral, hot pink, electric blue, cobalt,
# fuchsia) are intentionally excluded: they are evening-capable in the right
# silhouette and should not be hard-coded as daytime.
_SUMMERY_COLORS: Set[str] = {
    "lime", "lime green", "chartreuse", "neon green", "neon yellow",
    "neon pink", "neon orange", "bright yellow", "yellow green",
    "teal green", "tropical green",
}

# Style tags / descriptor tokens that EXPLICITLY signal daytime / beach character.
# Deliberately narrow: "lightweight", "vacation", "resort" are intentionally
# excluded because they appear in the descriptors of many non-summery items
# (lightweight wool blazer, vacation capsule wardrobe, resort-casual dress).
# Only use tokens that are unambiguously beach/summer-specific.
_SUMMERY_TOKENS: Set[str] = {
    "airy", "summery", "breezy", "tropical",
    "beach", "poolside",
    "flowy and light", "sun-ready",
}

# ── Pattern vocabulary ─────────────────────────────────────────────────────────
_SOLID_PATTERNS: Set[str]    = {"solid", "plain", "", "none"}
_BUSY_PATTERNS: Set[str]     = {
    "geometric", "tie-dye", "graphic", "abstract", "mosaic",
    "checkered", "plaid", "houndstooth", "mixed",
}
_ROMANTIC_PATTERNS: Set[str] = {"floral", "lace", "paisley", "ditsy", "botanical", "floral print"}
_BOLD_PATTERNS: Set[str]     = {
    "animal print", "leopard", "zebra", "snake", "geometric",
    "abstract", "color block", "tie-dye",
}

# ── Fit / silhouette vocabularies ─────────────────────────────────────────────
_STRUCTURED_FITS: Set[str]   = {"tailored", "fitted", "structured", "bodycon", "form-fitting"}
_RELAXED_FITS: Set[str]      = {"oversized", "baggy", "relaxed", "loose", "boxy"}
_FLOWY_FITS: Set[str]        = {"flowy", "a-line", "wrap", "bias-cut", "flared", "tiered"}


# ── Item attribute helpers ─────────────────────────────────────────────────────

def _item_fabric(item: Dict) -> str:
    desc = item.get("descriptors") or {}
    return (desc.get("fabric_type") or desc.get("fabric") or "").lower().strip()


def _item_fit(item: Dict) -> str:
    desc = item.get("descriptors") or {}
    return (desc.get("fit") or desc.get("silhouette") or "").lower().strip()


def _item_sleeve(item: Dict) -> str:
    desc = item.get("descriptors") or {}
    return (desc.get("sleeve_length") or desc.get("sleeve") or "").lower().strip()


def _item_type_str(item: Dict) -> str:
    return (item.get("item_type") or "").lower().strip()


def _item_pattern(item: Dict) -> str:
    return (item.get("pattern") or "").lower().strip()


def _item_color(item: Dict) -> str:
    return (item.get("color") or "").lower().strip()


def _item_formality(item: Dict) -> float:
    return float(item.get("formality_score") or NEUTRAL)


def _item_category(item: Dict) -> str:
    return (item.get("category") or "").lower().strip()


def _clamp(v: float) -> float:
    return max(0.0, min(1.0, v))


# Inline formality alignment (avoids circular import with recommender.py)
def _formality_alignment(item_f: float, event_f: float, tolerance: float = 0.25) -> float:
    diff = abs(item_f - event_f)
    if diff <= tolerance:
        return 1.0
    return max(0.0, 1.0 - (diff - tolerance) / (1.0 - tolerance))


# ─────────────────────────────────────────────────────────────────────────────
# Dimension 1: Dress Code (formality alignment)
# ─────────────────────────────────────────────────────────────────────────────

def _score_dim_dress_code(items: List[Dict], occasion: Dict) -> float:
    """
    Formality alignment between each item and the event's required dress code.
    Uses tighter tolerance (0.22 vs 0.25) for high-formality events (≥ 0.70)
    to gate out casually-coded items at cocktail/black-tie briefs.
    """
    event_formality = float(occasion.get("formality_level") or NEUTRAL)
    # Tighter tolerance at high formality
    tolerance = 0.22 if event_formality >= 0.70 else 0.25

    scores = [_formality_alignment(_item_formality(i), event_formality, tolerance) for i in items]
    return round(sum(scores) / len(scores), 4) if scores else NEUTRAL


# ─────────────────────────────────────────────────────────────────────────────
# Dimension 2: Mood (style mood / vibe alignment)
# ─────────────────────────────────────────────────────────────────────────────

def _mood_score_item(item: Dict, moods: Set[str]) -> float:
    """Score a single item against the set of detected event moods."""
    fabric    = _item_fabric(item)
    fit       = _item_fit(item)
    color     = _item_color(item)
    pattern   = _item_pattern(item)
    formality = _item_formality(item)
    style_tags: List[str] = [t.lower() for t in (item.get("style_tags") or [])]

    scores: List[float] = []

    if "elegant" in moods or "classic" in moods:
        s = 0.50
        if formality >= 0.65:                                      s += 0.25
        elif formality < 0.40:                                     s -= 0.22
        if fit in _STRUCTURED_FITS:                                s += 0.15
        elif fit in _RELAXED_FITS:                                 s -= 0.12
        if pattern in _SOLID_PATTERNS:                             s += 0.10
        elif pattern in _BUSY_PATTERNS:                            s -= 0.15
        if color in _NEUTRAL_COLORS or color in _DARK_RICH_COLORS: s += 0.05
        if any(t in style_tags for t in ("elegant", "classic", "refined", "polished")): s += 0.08
        scores.append(_clamp(s))

    if "romantic" in moods:
        s = 0.50
        if pattern in _ROMANTIC_PATTERNS:                          s += 0.25
        if fabric in {"chiffon", "silk", "lace", "satin"}:        s += 0.15
        if color in _ROMANTIC_COLORS:                              s += 0.15
        if fit in _FLOWY_FITS:                                     s += 0.10
        if any(t in style_tags for t in ("romantic", "feminine", "delicate")): s += 0.08
        scores.append(_clamp(s))

    if "bold" in moods or "sexy" in moods or "street smart" in moods:
        s = 0.50
        if color in _BOLD_COLORS:                                  s += 0.20
        if pattern in _BOLD_PATTERNS:                              s += 0.15
        if fit in {"bodycon", "mini", "cropped", "cutout", "asymmetric"}: s += 0.15
        if pattern in _SOLID_PATTERNS and color in _NEUTRAL_COLORS: s -= 0.10
        if any(t in style_tags for t in ("bold", "statement", "edgy", "sexy")): s += 0.08
        scores.append(_clamp(s))

    if "minimalist" in moods:
        s = 0.50
        if pattern in _SOLID_PATTERNS:                             s += 0.25
        if color in _NEUTRAL_COLORS:                               s += 0.15
        if pattern in _BUSY_PATTERNS or pattern in _ROMANTIC_PATTERNS: s -= 0.25
        if any(t in style_tags for t in ("minimal", "minimalist", "clean", "simple")): s += 0.08
        scores.append(_clamp(s))

    return round(sum(scores) / len(scores), 4) if scores else NEUTRAL


def _score_dim_mood(items: List[Dict], event_tokens: Set[str]) -> float:
    """Average mood alignment across all outfit items."""
    _MOOD_TOKENS: Set[str] = {
        "elegant", "classic", "romantic", "bold", "minimalist", "sexy", "street smart",
    }
    moods = _MOOD_TOKENS & event_tokens
    if not moods:
        return NEUTRAL

    scores = [_mood_score_item(i, moods) for i in items]
    return round(sum(scores) / len(scores), 4) if scores else NEUTRAL


# ─────────────────────────────────────────────────────────────────────────────
# Dimension 3: Time of Day
# ─────────────────────────────────────────────────────────────────────────────

def _is_evening_item(item: Dict) -> Optional[bool]:
    """
    Classify item as evening-coded (True), daytime-coded (False), or versatile (None).

    Signals checked in priority order:
      1. Fabric — velvet/satin/sequin → evening; linen/cotton/denim (low formality) → daytime
      2. Color  — summery/tropical/neon palette → daytime regardless of formality
      3. Style tags / descriptors — "airy", "summery", "tropical", etc. → daytime
      4. Season — summer-only item with moderate-or-lower formality → daytime
      5. Formality score — ≥ 0.70 → evening; (lower already caught above)
      6. Item type keywords — "cocktail"/"gown" → evening; "t-shirt"/"jeans" → daytime

    The key guarantee: a leather jacket or structured heel layered OVER a summery
    core piece cannot reclassify the outfit as evening-appropriate — the core
    garment's classification drives the time-of-day dimension score.
    """
    fabric    = _item_fabric(item)
    formality = _item_formality(item)
    itype     = _item_type_str(item)
    color     = _item_color(item)
    season    = (item.get("season") or "").lower()

    # 1. Fabric — strongest explicit signal
    if fabric in _EVENING_FABRICS:
        return True
    if fabric in _DAYTIME_FABRICS and formality < 0.38:
        return False

    # Pre-compute style tags + descriptor text (used by checks 2, 3, 4)
    style_tags: List[str] = [t.lower() for t in (item.get("style_tags") or [])]
    desc = item.get("descriptors") or {}
    desc_text = " ".join(str(v).lower() for v in desc.values() if v)
    tag_text  = " ".join(style_tags)
    combined  = f"{desc_text} {tag_text} {itype}"

    # 2. Color palette — neon / lime / chartreuse family are UNAMBIGUOUSLY daytime.
    # Require a confirming seasonal or descriptor signal for the color alone to
    # code an item as daytime — a neon or lime item that also reads "summer" or
    # "airy" is definitively daytime; the same color on a structured blazer without
    # those signals should remain versatile rather than being hard-coded daytime.
    is_summery_color = (
        color in _SUMMERY_COLORS
        or any(sc in color for sc in ("lime", "neon", "chartreuse"))
    )
    if is_summery_color:
        has_confirming_signal = (
            (season == "summer" and formality < 0.55)
            or any(tok in combined for tok in ("airy", "summery", "breezy", "tropical", "beach", "poolside"))
        )
        if has_confirming_signal:
            return False
        # Color alone without confirming signal → treat as versatile below

    # 3. Style tags and descriptor fields — explicit summery/beach tokens → daytime
    if any(tok in combined for tok in _SUMMERY_TOKENS):
        return False

    # 4. Season — summer-only items with moderate-or-lower formality → daytime
    if season == "summer" and formality < 0.55:
        return False

    # 5. Formality — high-formality items lean evening
    if formality >= 0.70:
        return True

    # 6. Item type keywords
    if any(k in itype for k in ("cocktail", "evening", "gown", "formal", "dinner")):
        return True
    if any(k in itype for k in ("t-shirt", "tank", "casual", "sundress", "jeans", "shorts", "hoodie")):
        return False

    return None  # versatile — neutral score


def _score_dim_time_of_day(items: List[Dict], event_tokens: Set[str]) -> float:
    """
    Score outfit fitness for the event's time of day.

    Evening/nighttime events heavily penalise daytime-coded items (score 0.20).
    Daytime events are lenient about over-dressing (slight penalty vs hard fail).

    Core-garment cap (evening only):
    ─────────────────────────────────
    Outerwear, shoes, and accessories are "finishing layers" — they can elevate
    a neutral look but they cannot override a summery/daytime-coded MAIN garment.
    If any non-outerwear, non-shoe, non-accessory item is daytime-coded at an
    evening event the dimension score is capped at 0.30 (below TIME_VETO 0.35)
    so the hard veto fires and the outfit is eliminated.

    Example: lime-green airy co-ord set + leather jacket + heeled sandals.
    Without the cap the jacket and heels (both versatile → 0.72) pull the
    average above TIME_VETO even though the main piece is daytime-coded.
    The cap ensures the veto fires regardless of how good the outerwear is.
    """
    is_evening = bool({"evening", "nighttime"} & event_tokens)
    is_daytime = "daytime" in event_tokens

    if not is_evening and not is_daytime:
        return NEUTRAL

    # Outerwear / shoes / accessories are "finishers", not main garments
    _FINISHER_CATS: Set[str] = {
        "outerwear", "shoes", "footwear",
        "accessories", "accessory", "jewelry", "bag",
    }

    scores: List[float] = []
    core_has_daytime_coded = False  # tracks whether a MAIN garment is day-coded

    for item in items:
        is_core  = _item_category(item) not in _FINISHER_CATS
        ev_coded = _is_evening_item(item)

        if is_evening:
            if ev_coded is True:
                scores.append(0.95)   # perfect evening piece
            elif ev_coded is None:
                scores.append(0.72)   # versatile — acceptable
            else:
                scores.append(0.20)   # daytime-coded at evening event
                if is_core:
                    core_has_daytime_coded = True
        else:  # daytime
            if ev_coded is False:
                scores.append(0.95)   # perfect daytime piece
            elif ev_coded is None:
                scores.append(0.72)   # versatile — fine
            else:
                scores.append(0.62)   # slightly over-dressed but ok

    avg = round(sum(scores) / len(scores), 4) if scores else NEUTRAL

    # Cap below TIME_VETO when a core garment is daytime-coded at an evening event
    if is_evening and core_has_daytime_coded:
        avg = min(avg, 0.30)

    return avg


# ─────────────────────────────────────────────────────────────────────────────
# Dimension 4: Weather
# ─────────────────────────────────────────────────────────────────────────────

def _score_dim_weather(items: List[Dict], occasion: Dict) -> float:
    """
    Score outfit fabric and coverage fit against weather conditions.

    Reads from:
      - occasion["temperature_context"] — LLM-inferred "cold", "warm", etc.
      - occasion["raw_text_json"]["weather"] — explicit user selection ("Rainy", "Cold", …)
      - event_tokens (notes parsing may have injected weather-adjacent tokens)
    """
    temp_ctx = (occasion.get("temperature_context") or "").lower()
    raw_weather = ""
    rtj = occasion.get("raw_text_json") or {}
    if rtj:
        raw_weather = str(rtj.get("weather") or "").lower()
    weather_text = f"{temp_ctx} {raw_weather}".strip()

    if not weather_text or weather_text == "unknown":
        return NEUTRAL

    is_rainy = any(w in weather_text for w in ("rain", "rainy", "drizzle", "wet", "storm"))
    is_cold  = any(w in weather_text for w in ("cold", "cool", "chilly", "freezing"))
    is_hot   = any(w in weather_text for w in ("hot", "warm", "humid", "heat"))

    if not is_rainy and not is_cold and not is_hot:
        return NEUTRAL

    scores: List[float] = []
    for item in items:
        fabric    = _item_fabric(item)
        category  = _item_category(item)
        sleeve    = _item_sleeve(item)
        season    = (item.get("season") or "all").lower()
        desc      = item.get("descriptors") or {}
        shoe_type = (desc.get("shoe_type") or "").lower()

        s = 0.50

        if is_rainy:
            # Delicate fabrics won't survive rain
            if fabric in _DELICATE_FABRICS:                                       s -= 0.25
            # Open-toe shoes in rain are a practical problem
            if category == "shoes" and any(
                k in shoe_type for k in ("sandal", "slide", "flip", "open")
            ):
                s -= 0.30
            # Outerwear is a positive signal (coverage)
            if category == "outerwear":                                           s += 0.20
            # Summer-only items (likely lightweight, uncovered)
            if season == "summer":                                                s -= 0.10

        if is_cold:
            if fabric in _HEAVY_FABRICS:                                          s += 0.25
            if category == "outerwear":                                           s += 0.20
            if sleeve in {"sleeveless", "cap", "strapless", "off-shoulder"}:     s -= 0.22
            if fabric in _BREATHABLE_FABRICS and fabric not in {"silk", "satin"}: s -= 0.10
            if season == "summer":                                                s -= 0.15

        if is_hot:
            if fabric in _BREATHABLE_FABRICS:                                     s += 0.20
            if fabric in _HEAVY_FABRICS:                                          s -= 0.22
            if sleeve in {"sleeveless", "short", "cap"}:                          s += 0.10
            if category == "outerwear" and fabric in _HEAVY_FABRICS:             s -= 0.25

        scores.append(_clamp(s))

    return round(sum(scores) / len(scores), 4) if scores else NEUTRAL


# ─────────────────────────────────────────────────────────────────────────────
# Dimension 5: Purpose
# ─────────────────────────────────────────────────────────────────────────────

def _score_dim_purpose(items: List[Dict], event_tokens: Set[str]) -> float:
    """
    Score outfit appropriateness for the stated event purpose.

    Date night / dinner: rewards polished formality range (0.55–0.90).
    Party:              more latitude — rewards festive and bold.
    Work event:         rewards professional range (0.50–0.85).
    """
    _PURPOSE_TOKENS: Set[str] = {
        "date night", "date", "dinner", "party", "work event",
        "vacation", "wedding guest", "concert", "brunch", "networking",
    }
    detected = _PURPOSE_TOKENS & event_tokens
    if not detected:
        return NEUTRAL

    is_date_night = bool({"date night", "date", "romantic"} & detected)
    is_dinner     = "dinner" in detected
    is_party      = "party" in detected
    is_work       = bool({"work event", "colleagues", "clients", "networking"} & detected)

    scores: List[float] = []
    for item in items:
        formality = _item_formality(item)
        fabric    = _item_fabric(item)
        category  = _item_category(item)
        s = 0.50

        if is_date_night or is_dinner:
            # Polished range — reward elegant, penalise too casual or too formal
            if 0.55 <= formality <= 0.90:    s += 0.28
            elif 0.40 <= formality < 0.55:   s += 0.10
            elif formality < 0.35:           s -= 0.22
            if fabric in _EVENING_FABRICS:   s += 0.10
            if category == "loungewear":     s -= 0.30

        if is_party:
            if formality >= 0.40:            s += 0.15
            if fabric in _EVENING_FABRICS:   s += 0.10
            if category == "loungewear":     s -= 0.15

        if is_work:
            if 0.50 <= formality <= 0.85:    s += 0.22
            elif formality < 0.35:           s -= 0.25
            if category in {"loungewear", "swimwear"}: s -= 0.30

        scores.append(_clamp(s))

    return round(sum(scores) / len(scores), 4) if scores else NEUTRAL


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────

def score_event_appropriate(
    items: List[Dict[str, Any]],
    occasion: Dict[str, Any],
) -> Tuple[float, Dict[str, float], str]:
    """
    Multi-dimensional event alignment scorer.

    Args:
        items:    Outfit items (wardrobe item dicts with formality_score,
                  category, descriptors, color, pattern, season, style_tags…)
        occasion: Event/occasion dict with formality_level, temperature_context,
                  event_tokens, and optionally raw_text_json.

    Returns:
        composite_score  — 0.0 if hard-vetoed; else weighted dim average [0, 1]
        dim_scores       — per-dimension scores for outfit card explainability
        label            — human-readable summary string
    """
    if not items:
        return NEUTRAL, {d: NEUTRAL for d in _DIM_WEIGHTS}, "no items to score"

    event_tokens: Set[str] = {
        str(t).lower().strip()
        for t in (occasion.get("event_tokens") or [])
        if str(t).strip()
    }

    # ── Score each dimension ────────────────────────────────────────────────
    dim_scores: Dict[str, float] = {
        "dress_code":  _score_dim_dress_code(items, occasion),
        "mood":        _score_dim_mood(items, event_tokens),
        "time_of_day": _score_dim_time_of_day(items, event_tokens),
        "weather":     _score_dim_weather(items, occasion),
        "purpose":     _score_dim_purpose(items, event_tokens),
    }

    # ── Hard veto rule 1: Dress code fundamentally misaligned ──────────────
    # A casual item at a cocktail event cannot be saved by a good color story.
    if dim_scores["dress_code"] < VETO_THRESHOLD:
        logger.debug(
            "event_appropriate: HARD VETO (dress_code) — score=%.3f < %.2f",
            dim_scores["dress_code"], VETO_THRESHOLD,
        )
        return 0.0, dim_scores, "eliminated: dress code mismatch"

    # ── Hard veto rule 2: Wrong time of day (when explicitly specified) ─────
    # Only fires when the brief contains a time signal — prevents over-penalising
    # events where the user left time-of-day blank.
    has_time_signal = bool({"evening", "nighttime", "daytime"} & event_tokens)
    if has_time_signal and dim_scores["time_of_day"] < TIME_VETO:
        logger.debug(
            "event_appropriate: HARD VETO (time_of_day) — score=%.3f < %.2f",
            dim_scores["time_of_day"], TIME_VETO,
        )
        return 0.0, dim_scores, "eliminated: wrong time of day coding"

    # ── Weighted composite ──────────────────────────────────────────────────
    composite = sum(_DIM_WEIGHTS[d] * dim_scores[d] for d in _DIM_WEIGHTS)
    composite = round(_clamp(composite), 4)

    # ── Label ───────────────────────────────────────────────────────────────
    if composite >= 0.82:
        label = "strong event match"
    elif composite >= 0.68:
        label = "good event alignment"
    elif composite >= 0.52:
        label = "partial event match"
    else:
        label = "weak event alignment"

    logger.debug(
        "event_appropriate: composite=%.3f dims=%s label=%s",
        composite, dim_scores, label,
    )
    return composite, dim_scores, label
