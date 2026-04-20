"""
services/recommender.py — Core outfit recommendation engine
=============================================================
v2.5.0 — multi-dimensional event alignment replaces single-axis appropriateness.

  V1 scorer (used by attach_accessories):
    score = w1*color_harmony + w2*formality + w3*season
          + w4*embedding_similarity + w5*preference + w6*style_coherence

  V2 scorer (used by generate_outfit_suggestions):
    score = C*compatibility + E*event_appropriate + P*preference
          + F*flattery + T*trend + N*novelty + D*diversity + S*polish − R*risk_penalty

  V2 components:
    compatibility     — pairwise item compat (color story + silhouette + formality match)
    event_appropriate — multi-dim event alignment (services/event_appropriate.py):
                          dress_code 0.30 · mood 0.25 · time_of_day 0.20 · weather 0.15 · purpose 0.10
                        Hard veto: dress_code < 0.40 OR (time specified AND time_of_day < 0.35)
                        → outfit eliminated (score forced to 0.0)
    preference        — personal style (feedback history + body-type priors)
    flattery          — physical fit (body type + proportion + neckline + complexion-color)
    trend             — seasonal trend relevance (trend_calendar.json via trend_service)
    novelty           — freshness vs recently shown outfit history
    diversity         — completeness bonus for covering expected outfit slots
    polish            — finishing-piece quality (shoes + outerwear + jewelry + accessories)
    risk_penalty      — dress-code / confidence penalty (subtracted from final)

Pipeline:
  1. Filter items to valid candidates for the occasion
  2. Build core outfit combinations across 4 outfit families
  3. Score each combination using V2 outfit-level intelligence
  4. Attach up to 2 finishing pieces (accessories/jewelry) per outfit using rule-based logic
  5. Generate LLM explanations for top-N outfits (seeded with V2 score breakdown tags)
  6. Return ranked suggestions
"""

from __future__ import annotations
import itertools
import json as _json
import logging
import pathlib as _pathlib
from typing import List, Dict, Any, Optional, Set, Tuple
from uuid import uuid4
from datetime import datetime

from ml.embeddings import cosine_similarity
from ml.llm import explain_outfit

# ── Fashion rule JSON assets ───────────────────────────────────────────────────
# Loaded once at import time; each returns {} on any IO/parse error so scoring
# degrades gracefully to neutral (0.5) rather than crashing.
_RULES_DIR = _pathlib.Path(__file__).parent.parent / "assets" / "fashion_rules"

def _load_rule_asset(filename: str) -> dict:
    try:
        with open(_RULES_DIR / filename, "r", encoding="utf-8") as _f:
            return _json.load(_f)
    except Exception:
        return {}

_BODY_TYPE_RULES       = _load_rule_asset("body_type.json")
_BODY_PROPORTION_RULES = _load_rule_asset("body_proportion.json")
_NECKLINE_RULES        = _load_rule_asset("neckline.json")
_SKIN_TONE_RULES       = _load_rule_asset("skin_tone.json")
_COLOR_THEORY_RULES    = _load_rule_asset("color_theory.json")
_SHOES_RULES           = _load_rule_asset("shoes.json")
_OUTERWEAR_RULES       = _load_rule_asset("outerwear.json")
_JEWELRY_RULES         = _load_rule_asset("jewelry.json")
_ACCESSORIES_RULES     = _load_rule_asset("accessories.json")

logger = logging.getLogger(__name__)
_DEBUG_SCORE_STAGES = {"template_best", "selected_outfit"}


def _debug_outfit_signature(items: List[Dict]) -> str:
    parts = []
    for item in items:
        cat = _normalize_category_name(item.get("category")) or "unknown"
        item_id = str(item.get("id") or "")[:8]
        label = (item.get("item_type") or item.get("subcategory") or "").strip().lower()
        if label:
            parts.append(f"{cat}:{label}:{item_id}")
        else:
            parts.append(f"{cat}:{item_id}")
    return " | ".join(parts)


def _debug_print_score(stage: str, items: List[Dict], **values: Any) -> None:
    if stage not in _DEBUG_SCORE_STAGES:
        return
    fields = [f"stage={stage}", f"outfit={_debug_outfit_signature(items)}"]
    for key, value in values.items():
        if isinstance(value, float):
            fields.append(f"{key}={value:.4f}")
        else:
            fields.append(f"{key}={value}")
    print("[Recommender][Score] " + " ".join(fields), flush=True)

# ── Scoring weights ────────────────────────────────────────────────────────────
WEIGHTS = {
    "color":      0.18,   # perceptual color harmony (HSL-based)
    "formality":  0.18,   # occasion formality alignment
    "season":     0.12,   # temperature/season match
    "embedding":  0.28,   # CLIP visual similarity
    "preference": 0.12,   # feedback history + body-type priors
    "coherence":  0.12,   # pattern mixing + fit consistency
}
assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9, "Weights must sum to 1.0"

# ── V2 scoring weights (outfit-level intelligence) ─────────────────────────────
# Scores the outfit as a composed look, not a sum of independent items.
#
# v2.5 — Introduced event_appropriate (multi-dim event alignment) to replace the
# single-axis appropriateness scorer.  Weight redistributed:
#   compatibility  0.23 → 0.17  (less emphasis on pair-matching, event fit matters more)
#   appropriateness 0.24 removed; replaced by event_appropriate 0.35
#   preference     0.20 → 0.15  (personal taste yields to event requirements)
WEIGHTS_V2 = {
    "compatibility":      0.17,  # C — pairwise item compat (color story + silhouette + formality)
    "event_appropriate":  0.35,  # E — multi-dim event alignment (dress_code/mood/time/weather/purpose)
    "preference":         0.15,  # P — personal style (feedback history + body-type priors)
    "flattery":           0.12,  # F — physical fit (body type + proportion + neckline + complexion-color)
    "trend":              0.08,  # T — seasonal trend relevance (trend_calendar.json)
    "novelty":            0.03,  # N — freshness vs recently shown outfit history
    "diversity":          0.02,  # D — outfit slot completeness bonus
    "polish":             0.05,  # S — finishing-piece quality (shoe + outerwear + jewelry + accessory fit)
}
RISK_WEIGHT = 0.03              # R — dress-code / confidence penalty (subtracted from final)
assert abs(sum(WEIGHTS_V2.values()) + RISK_WEIGHT - 1.0) < 1e-9, "WEIGHTS_V2 + RISK_WEIGHT must sum to 1.0"

# ── Formality tolerance band ───────────────────────────────────────────────────
FORMALITY_TOLERANCE = 0.25

# ── Color name → approximate RGB ──────────────────────────────────────────────
COLOR_RGB: Dict[str, Tuple[int, int, int]] = {
    "black":     (10,  10,  10),
    "white":     (250, 250, 250),
    "beige":     (245, 225, 200),
    "cream":     (255, 253, 240),
    "ivory":     (255, 255, 240),
    "grey":      (150, 150, 150),
    "gray":      (150, 150, 150),
    "charcoal":  (54,  69,  79),
    "silver":    (192, 192, 192),
    "multicolor": (170, 135, 145),
    "navy":      (0,   0,   80),
    "brown":     (101, 67,  33),
    "camel":     (193, 154, 107),
    "tan":       (210, 180, 140),
    "khaki":     (195, 176, 145),
    "red":       (220, 20,  20),
    "burgundy":  (128, 0,   32),
    "rust":      (183, 65,  14),
    "orange":    (230, 120, 30),
    "coral":     (255, 127, 80),
    "yellow":    (255, 220, 40),
    "mustard":   (210, 170, 50),
    "gold":      (212, 175, 55),
    "green":     (50,  140, 50),
    "olive":     (107, 120, 40),
    "sage":      (143, 188, 143),
    "mint":      (165, 220, 200),
    "teal":      (0,   128, 128),
    "blue":      (50,  100, 220),
    "cobalt":    (0,   71,  171),
    "purple":    (120, 50,  160),
    "lavender":  (220, 200, 250),
    "pink":      (240, 140, 170),
    "blush":     (255, 182, 193),
    "magenta":   (255, 0,   255),
}

# Low-saturation (neutral) color names used as fallback
NEUTRAL_NAMES = {"black", "white", "beige", "cream", "ivory", "grey", "gray",
                 "charcoal", "silver", "brown", "camel", "tan", "khaki"}

_WALKABLE_OUTDOOR_TOKENS = {
    "park", "picnic", "garden", "market", "walking", "hiking",
    # Activity/comfort signals that imply on-foot movement
    "grass", "trail", "nature", "stroll", "comfortable",
}
_MINIMAL_STYLE_TOKENS = {"minimal", "minimalist"}
# Occasion tokens that explicitly call for comfort-first footwear
_COMFORT_OCCASION_TOKENS = {"comfortable", "active", "athletic", "sport", "casual", "grass", "trail", "stroll"}

# ── Brief-derived token sets (vocabulary = EventBriefEditor option values) ────
#
# These token sets mirror the exact lowercased option values from the frontend
# EventBriefEditor dropdowns.  _enrich_event_tokens() in event_service.py
# injects them verbatim so scoring gates fire from whatever the user explicitly
# told us — not from assumptions about specific venue names.

# User explicitly chose "Comfort" over "Fashion" OR wrote activity keywords in notes
_COMFORT_FIRST_TOKENS  = {"comfort", "comfortable", "walking", "hiking", "dancing",
                           "standing", "sitting", "grass", "all day", "day to night", "half day"}

# User explicitly chose "Fashion" → relax comfort-penalty pressure
_FASHION_FIRST_TOKENS  = {"fashion"}

# Duration tokens that compound comfort expectations
_LONG_DURATION_TOKENS  = {"all day", "day to night", "half day"}

# Style-mood tokens that drive pattern/complexity scoring
_MINIMALIST_MOOD_TOKENS = {"minimalist"}
_BOLD_MOOD_TOKENS       = {"bold", "street smart", "sexy"}
_ELEGANT_MOOD_TOKENS    = {"elegant", "classic"}
_ROMANTIC_MOOD_TOKENS   = {"romantic"}

# Audience tokens that nudge formality tolerance
_DATE_AUDIENCE_TOKENS         = {"date", "date night", "romantic"}
_PROFESSIONAL_AUDIENCE_TOKENS = {"colleagues", "clients", "work event"}


def _occasion_token_set(occasion: Dict) -> set[str]:
    return {str(token).lower().strip() for token in (occasion.get("event_tokens") or []) if str(token).strip()}


def _shoe_signals(item: Dict) -> Dict[str, bool]:
    desc = item.get("descriptors") or {}
    shoe_type = (desc.get("shoe_type") or "").lower().strip()
    heel_height = (desc.get("heel_height") or "").lower().strip()
    heel_type = (desc.get("heel_type") or "").lower().strip()
    item_type = (item.get("item_type") or "").lower().strip()
    profile = " ".join(part for part in [shoe_type, heel_height, heel_type, item_type] if part)

    is_sneaker = any(key in profile for key in ("sneaker", "trainer"))
    is_flat_family = any(key in profile for key in ("flat", "loafer", "oxford", "espadrille"))
    is_sandal = any(key in profile for key in ("sandal", "slide", "flip"))
    is_heel = (
        # Check full profile (includes item_type) so "strappy heels" is caught even
        # when shoe_type is only tagged as "strappy" without an explicit "heel" token
        any(key in profile for key in ("heel", "pump", "stiletto"))
        or heel_height in {"mid", "high", "platform"}
        or any(key in heel_type for key in ("stiletto", "block", "wedge", "kitten", "cone", "spool", "chunky", "sculptural"))
    )
    is_walkable = is_sneaker or is_flat_family or (is_sandal and heel_height in {"", "flat", "low"})

    return {
        "is_sneaker": is_sneaker,
        "is_flat_family": is_flat_family,
        "is_sandal": is_sandal,
        "is_heel": is_heel,
        "is_walkable": is_walkable,
    }


# ── Body-type silhouette preference tables ─────────────────────────────────────
# Values are sub-strings to match inside descriptor fields (case-insensitive).
BODY_TYPE_PREFERENCES: Dict[str, Dict[str, Dict[str, List[str]]]] = {
    "hourglass": {
        "tops":      {"fit": ["fitted", "bodycon", "wrap", "tailored"],
                      "neckline": ["v-neck", "sweetheart", "plunging", "wrap"]},
        "bottoms":   {"fit": ["fitted", "slim", "skinny"],
                      "leg_opening": ["straight", "skinny", "flare"]},
        "dresses":   {"fit": ["fitted", "bodycon", "wrap"],
                      "length": ["midi", "knee", "mini"]},
        "jumpsuits": {"fit": ["fitted", "tailored", "wrap"],
                      "length": ["ankle", "full-length", "cropped"],
                      "leg_shape": ["straight", "tapered", "flared"]},
        "outerwear": {"fit": ["fitted", "tailored"]},
        "set":       {"fit": ["fitted", "wrap", "tailored"],
                      "bottom_style": ["midi skirt", "mini skirt", "trousers"]},
        "swimwear":  {"swimwear_style": ["bikini", "one-piece"],
                      "coverage_level": ["moderate"]},
        "loungewear":{"fit": ["fitted", "relaxed"],
                      "loungewear_type": ["matching set", "tank set"]},
    },
    "rectangle": {
        "tops":      {"fit": ["oversized", "relaxed", "boxy", "peplum"],
                      "neckline": ["scoop", "square", "off-shoulder", "sweetheart"]},
        "bottoms":   {"fit": ["wide", "relaxed", "high-waist"],
                      "leg_opening": ["wide", "flare", "bootcut"]},
        "dresses":   {"fit": ["a-line", "shift", "wrap", "peplum"],
                      "length": ["midi", "maxi"]},
        "jumpsuits": {"fit": ["tailored", "relaxed", "wrap"],
                      "length": ["ankle", "full-length", "cropped"],
                      "leg_shape": ["wide-leg", "straight", "culotte"]},
        "outerwear": {"fit": ["oversized", "relaxed", "belted"]},
        "set":       {"fit": ["relaxed", "oversized", "wrap"],
                      "top_style": ["crop", "off-shoulder", "bralette"]},
        "swimwear":  {"swimwear_style": ["bikini", "monokini", "bandeau", "triangle"]},
        "loungewear":{"fit": ["oversized", "relaxed"],
                      "loungewear_type": ["hoodie", "sweatpants", "matching set"]},
    },
    "pear": {
        "tops":      {"fit": ["oversized", "relaxed", "structured", "peplum"],
                      "neckline": ["boat", "off-shoulder", "square", "sweetheart", "scoop"]},
        "bottoms":   {"fit": ["a-line", "relaxed"],
                      "leg_opening": ["flare", "wide", "bootcut"]},
        "dresses":   {"fit": ["a-line", "wrap", "empire"],
                      "length": ["midi", "knee"]},
        "jumpsuits": {"fit": ["tailored", "relaxed", "wrap"],
                      "length": ["ankle", "full-length", "cropped"],
                      "leg_shape": ["wide-leg", "straight", "flared"]},
        "outerwear": {"fit": ["structured", "tailored"]},
        "set":       {"fit": ["relaxed", "a-line"],
                      "bottom_style": ["midi skirt", "wide-leg trousers"]},
        "swimwear":  {"swimwear_style": ["tankini", "one-piece", "swim dress"],
                      "coverage_level": ["moderate", "full"]},
        "loungewear":{"fit": ["relaxed", "oversized"],
                      "loungewear_type": ["hoodie", "joggers", "shorts set"]},
    },
    "apple": {
        "tops":      {"fit": ["relaxed", "regular", "empire"],
                      "neckline": ["v-neck", "plunging", "scoop"]},
        "bottoms":   {"fit": ["straight", "regular"],
                      "leg_opening": ["straight", "wide", "bootcut"]},
        "dresses":   {"fit": ["empire", "wrap", "shift"],
                      "length": ["midi", "maxi"]},
        "jumpsuits": {"fit": ["relaxed", "regular", "wrap"],
                      "length": ["ankle", "full-length", "cropped"],
                      "leg_shape": ["straight", "wide-leg", "culotte"]},
        "outerwear": {"fit": ["open-front", "relaxed"]},
        "set":       {"fit": ["relaxed", "regular"],
                      "top_style": ["camisole", "shirt", "waistcoat"]},
        "swimwear":  {"swimwear_style": ["one-piece", "tankini", "swim dress"],
                      "coverage_level": ["moderate", "full"]},
        "loungewear":{"fit": ["relaxed", "regular"],
                      "loungewear_type": ["robe", "matching set", "tank set"]},
    },
    "inverted triangle": {
        "tops":      {"fit": ["regular", "relaxed"],
                      "neckline": ["crew", "turtleneck", "boat", "high-neck"]},
        "bottoms":   {"fit": ["wide", "relaxed", "high-waist"],
                      "leg_opening": ["wide", "flare", "bootcut", "barrel"]},
        "dresses":   {"fit": ["a-line", "wrap", "fit and flare"],
                      "length": ["midi", "maxi"]},
        "jumpsuits": {"fit": ["relaxed", "tailored", "wrap"],
                      "length": ["ankle", "full-length", "cropped"],
                      "leg_shape": ["wide-leg", "straight", "flared"]},
        "outerwear": {"fit": ["relaxed", "oversized"]},
        "set":       {"fit": ["relaxed", "regular"],
                      "bottom_style": ["wide-leg trousers", "midi skirt", "skirt"]},
        "swimwear":  {"swimwear_style": ["bikini", "one-piece", "bandeau", "sporty", "balconette"]},
        "loungewear":{"fit": ["relaxed", "oversized"],
                      "loungewear_type": ["sweatpants", "joggers", "matching set"]},
    },
    "petite": {
        "tops":      {"fit": ["fitted", "slim", "cropped"],
                      "length": ["crop", "waist-length"]},
        "bottoms":   {"fit": ["slim", "fitted", "skinny"],
                      "leg_opening": ["skinny", "straight", "tapered"]},
        "dresses":   {"fit": ["shift", "fitted"],
                      "length": ["mini", "knee"]},
        "jumpsuits": {"fit": ["fitted", "tailored", "slim"],
                      "length": ["short", "cropped", "ankle"],
                      "leg_shape": ["straight", "tapered", "shorts"]},
        "outerwear": {"fit": ["fitted", "cropped"]},
        "set":       {"fit": ["fitted", "slim"],
                      "bottom_style": ["mini skirt", "shorts", "straight trousers"]},
        "swimwear":  {"swimwear_style": ["bikini", "monokini"],
                      "coverage_level": ["minimal", "moderate"]},
        "loungewear":{"fit": ["fitted", "slim"],
                      "loungewear_type": ["shorts set", "tank set", "matching set"]},
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Color scoring (HSL-based)
# ─────────────────────────────────────────────────────────────────────────────

def _rgb_to_hsl(r: int, g: int, b: int) -> Tuple[float, float, float]:
    """Convert RGB (0-255) to HSL. Returns (h: 0-360, s: 0-1, l: 0-1)."""
    r_, g_, b_ = r / 255.0, g / 255.0, b / 255.0
    cmax = max(r_, g_, b_)
    cmin = min(r_, g_, b_)
    delta = cmax - cmin

    l = (cmax + cmin) / 2.0

    s = 0.0 if delta == 0 else delta / (1.0 - abs(2.0 * l - 1.0))

    if delta == 0:
        h = 0.0
    elif cmax == r_:
        h = 60.0 * (((g_ - b_) / delta) % 6)
    elif cmax == g_:
        h = 60.0 * ((b_ - r_) / delta + 2.0)
    else:
        h = 60.0 * ((r_ - g_) / delta + 4.0)

    return h, s, l


def score_color_compatibility(color_a: str, color_b: str) -> float:
    """
    Returns 0.0–1.0 representing how well two colors work together.
    Uses HSL color theory: neutral pairs (1.0), complementary (0.90),
    analogous (0.80), monochromatic (0.85), triadic (0.72), discordant (0.55).
    """
    a, b = color_a.lower().strip(), color_b.lower().strip()
    if a == b:
        return 0.85  # monochromatic — good, not perfect (avoids head-to-toe sameness)

    from services.taxonomy import get_color_rgb
    _color_rgb = get_color_rgb()
    rgb_a = _color_rgb.get(a)
    rgb_b = _color_rgb.get(b)

    # Fall back to name-based neutral detection if color not in table
    if not rgb_a or not rgb_b:
        if a in NEUTRAL_NAMES or b in NEUTRAL_NAMES:
            return 1.0
        return 0.65

    h_a, s_a, l_a = _rgb_to_hsl(*rgb_a)
    h_b, s_b, l_b = _rgb_to_hsl(*rgb_b)

    # Neutrals: very low saturation → pairs with anything
    is_neutral_a = s_a < 0.15
    is_neutral_b = s_b < 0.15

    if is_neutral_a and is_neutral_b:
        return 1.0   # two neutrals — always clean
    if is_neutral_a or is_neutral_b:
        return 0.95  # neutral + any color

    # Circular hue distance
    hue_diff = min(abs(h_a - h_b), 360.0 - abs(h_a - h_b))

    if hue_diff < 15:
        return 0.85   # monochromatic band
    if hue_diff < 45:
        return 0.80   # analogous — harmonious
    if 150 <= hue_diff <= 210:
        return 0.90   # complementary — high contrast, fashion-forward
    if 100 <= hue_diff <= 150:
        return 0.72   # triadic / split-complementary
    return 0.55       # discordant — risky pairing


# ─────────────────────────────────────────────────────────────────────────────
# Formality scoring (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

def score_formality_alignment(item_formality: float, event_formality: float) -> float:
    """
    Returns 1.0 if item formality is within tolerance of event formality,
    scaling down linearly outside that band.
    """
    diff = abs(item_formality - event_formality)
    if diff <= FORMALITY_TOLERANCE:
        return 1.0
    return max(0.0, 1.0 - (diff - FORMALITY_TOLERANCE) / (1.0 - FORMALITY_TOLERANCE))


# ─────────────────────────────────────────────────────────────────────────────
# Season scoring (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

def score_season_compatibility(item_season: str, event_temperature: str) -> float:
    """
    Returns 1.0 for season match or 'all' items, 0.5 for unknown/partial match.
    """
    if item_season == "all":
        return 1.0
    season_temp_map = {
        "summer": ["warm", "outdoor", "hot"],
        "winter": ["cold", "indoor"],
        "spring": ["mild", "outdoor", "indoor"],
        "fall":   ["mild", "cool", "indoor"],
    }
    compatible = season_temp_map.get(item_season, [])
    temp = (event_temperature or "").lower()
    return 1.0 if any(t in temp for t in compatible) else 0.5


# ─────────────────────────────────────────────────────────────────────────────
# Embedding similarity
# ─────────────────────────────────────────────────────────────────────────────

def compute_outfit_embedding_score(items: List[Dict]) -> float:
    """
    Average pairwise cosine similarity across all outfit items.
    Higher = more visually cohesive.
    """
    embeddings = [item["embedding_vector"] for item in items if item.get("embedding_vector")]
    if len(embeddings) < 2:
        return 0.5  # not enough data — neutral

    pairs   = list(itertools.combinations(embeddings, 2))
    total   = sum(cosine_similarity(a, b) for a, b in pairs)
    average = total / len(pairs)
    return (average + 1.0) / 2.0   # map [-1, 1] → [0, 1]


# ─────────────────────────────────────────────────────────────────────────────
# Style coherence scoring
# ─────────────────────────────────────────────────────────────────────────────

_OVERSIZED_FITS = {"oversized", "relaxed", "loose", "boxy", "slouchy",
                   "wide", "wide-leg", "flare", "flared", "bootcut", "barrel", "voluminous"}
_FITTED_FITS    = {"fitted", "slim", "skinny", "bodycon", "tailored", "second-skin"}


def score_pattern_coherence(outfit_items: List[Dict]) -> float:
    """
    Outfits with fewer patterned items are more coherent.
    One statement pattern is fine; two+ patterns compete visually.
    """
    patterned = sum(
        1 for item in outfit_items
        if (item.get("pattern") or "").lower() not in ("solid", "plain", "none", "")
    )
    if patterned == 0:
        return 1.0   # all solids — clean and versatile
    if patterned == 1:
        return 0.85  # one statement piece
    if patterned == 2:
        return 0.55  # bold pattern mix — risky
    return 0.25      # 3+ patterns — likely clashing


def score_style_coherence(outfit_items: List[Dict]) -> float:
    """
    Combined coherence score:
      60% pattern coherence + 40% fit consistency.
    Fit consistency penalises mixing oversized and fitted pieces
    (e.g. huge baggy top + skin-tight bottom).
    """
    pattern_score = score_pattern_coherence(outfit_items)

    fits = [
        (item.get("descriptors") or {}).get("fit", "").lower()
        for item in outfit_items
    ]
    fits = [f for f in fits if f]  # drop empty

    if len(fits) < 2:
        fit_score = 0.8  # not enough descriptor data — slightly below perfect
    else:
        n_oversized = sum(1 for f in fits if any(v in f for v in _OVERSIZED_FITS))
        n_fitted    = sum(1 for f in fits if any(v in f for v in _FITTED_FITS))

        if n_oversized > 0 and n_fitted > 0:
            # Proportion of the minority fit type = conflict intensity
            conflict = min(n_oversized, n_fitted) / len(fits)
            fit_score = 1.0 - 0.45 * conflict
        else:
            fit_score = 0.90  # consistent or undetermined

    return 0.60 * pattern_score + 0.40 * fit_score


# ─────────────────────────────────────────────────────────────────────────────
# Body-type silhouette scoring
# ─────────────────────────────────────────────────────────────────────────────

def score_body_type_fit(outfit_items: List[Dict], body_type: Optional[str]) -> float:
    """
    Score how well outfit descriptors match the user's body-type preferences.
    Returns 0.5 (neutral) when body type is not set or descriptor data is sparse.
    """
    if not body_type:
        return 0.5

    from services.taxonomy import get_body_type_prefs
    prefs = get_body_type_prefs().get(body_type.lower().strip())
    if not prefs:
        return 0.5

    match_count = 0
    check_count = 0

    for item in outfit_items:
        cat = (item.get("category") or "").lower()
        cat_prefs = prefs.get(cat)
        if not cat_prefs:
            continue

        descriptors = item.get("descriptors") or {}
        for attr, preferred_vals in cat_prefs.items():
            val = (descriptors.get(attr) or "").lower()
            if not val:
                continue
            check_count += 1
            if any(pv.lower() in val for pv in preferred_vals):
                match_count += 1

    if check_count == 0:
        return 0.5  # no descriptor data — neutral

    # 0.5 base + up to 0.5 from preference matches
    return 0.5 + 0.5 * (match_count / check_count)


# ─────────────────────────────────────────────────────────────────────────────
# Flattery scoring — powered by fashion_rules JSON assets
# ─────────────────────────────────────────────────────────────────────────────

# ── Semantic descriptor mappings derived from body_type.json ──────────────────
# Maps body-type subtype → which descriptor values are flattering vs unflattering.
# These are intentionally broad so partial string matching works ("wide-leg" ⊃ "wide").
_BT_RULES: Dict[str, Dict[str, Any]] = {
    "hourglass": {
        "good_fits":     {"fitted", "slim", "tailored", "bodycon", "second-skin", "wrap"},
        "bad_fits":      {"boxy", "oversized", "relaxed", "loose", "slouchy"},
        "good_necklines": {"v-neck", "wrap", "sweetheart", "plunging", "deep-v"},
        "bad_necklines":  set(),
    },
    "pear": {
        # Structured tops balance wide hips; avoid clingy bottoms
        "good_fits":     {"structured", "fitted", "tailored", "a-line", "flare", "wide-leg"},
        "bad_fits":      {"skinny", "bodycon", "second-skin"},
        "good_necklines": {"boat", "off-shoulder", "square", "wide", "bateau"},
        "bad_necklines":  set(),
    },
    "apple": {
        # V-necks elongate; flowing/empire lines skim the midsection
        "good_fits":     {"flowy", "relaxed", "a-line", "empire", "loose", "wrap"},
        "bad_fits":      {"bodycon", "second-skin", "tight", "fitted"},
        "good_necklines": {"v-neck", "plunging", "deep-v", "wrap"},
        "bad_necklines":  {"crew", "turtleneck", "high-neck", "mock-neck"},
    },
    "rectangle": {
        # Create the illusion of curves — peplum, wrap, belted silhouettes
        "good_fits":     {"peplum", "a-line", "wrap", "flare", "bodycon", "belted"},
        "bad_fits":      {"boxy", "straight", "shift"},
        "good_necklines": {"sweetheart", "wrap", "v-neck", "scoop"},
        "bad_necklines":  set(),
    },
    "inverted_triangle": {
        # Balance broad shoulders with volume below the waist
        "good_fits":     {"wide-leg", "flare", "bootcut", "barrel", "a-line", "full"},
        "bad_fits":      set(),
        "good_necklines": {"v-neck", "plunging", "scoop"},
        "bad_necklines":  {"boat", "off-shoulder", "square", "bateau", "wide"},
    },
}

# Normalize common body_type strings to canonical keys
_BT_ALIAS: Dict[str, str] = {
    "hourglass":          "hourglass",
    "pear":               "pear",
    "triangle":           "pear",
    "apple":              "apple",
    "round":              "apple",
    "rectangle":          "rectangle",
    "straight":           "rectangle",
    "athletic":           "rectangle",
    "inverted_triangle":  "inverted_triangle",
    "inverted triangle":  "inverted_triangle",
    "inverted-triangle":  "inverted_triangle",
}

# ── Complexion → recommended / avoid color sets (from skin_tone.json) ─────────
_COMPLEXION_COLOR_MAP: Dict[str, Dict[str, set]] = {
    "fair": {
        "recommended": {
            "pink", "blush", "lavender", "mint", "peach", "lilac", "rose",
            "powder", "pastel", "white", "cream", "ivory", "nude", "pearl",
            "sky blue", "baby blue", "soft yellow", "dusty",
        },
        "avoid": {"neon", "lime", "fluorescent"},
    },
    "medium": {
        "recommended": {
            "orange", "yellow", "red", "coral", "rust", "terracotta", "brown",
            "camel", "gold", "olive", "emerald", "teal", "burgundy", "ruby",
            "sapphire", "cobalt", "forest", "mustard", "amber", "warm",
            "earth", "jewel", "copper", "brick", "ochre",
        },
        "avoid": {"icy", "ash", "cool grey", "powder", "silver"},
    },
    "deep": {
        "recommended": {
            "red", "orange", "fuchsia", "magenta", "hot pink", "cobalt",
            "royal blue", "emerald", "bright", "bold", "saturated", "vivid",
            "electric", "vibrant", "yellow", "coral", "chartreuse",
        },
        "avoid": {"taupe", "greige", "mushroom", "stone", "muted", "khaki"},
    },
}

_COMPLEXION_ALIASES: Dict[str, str] = {
    "fair":       "fair",
    "light":      "fair",
    "pale":       "fair",
    "porcelain":  "fair",
    "alabaster":  "fair",
    "ivory":      "fair",
    "medium":     "medium",
    "olive":      "medium",
    "tan":        "medium",
    "warm":       "medium",
    "golden":     "medium",
    "caramel":    "medium",
    "honey":      "medium",
    "beige":      "medium",
    "dark":       "deep",
    "deep":       "deep",
    "rich":       "deep",
    "espresso":   "deep",
    "ebony":      "deep",
    "mahogany":   "deep",
}


def _complexion_bucket(complexion: str) -> Optional[str]:
    """Map free-text complexion string to 'fair' | 'medium' | 'deep' | None."""
    c = complexion.lower().strip()
    for alias, bucket in _COMPLEXION_ALIASES.items():
        if alias in c:
            return bucket
    return None


def _score_flattery_body_type(
    outfit_items: List[Dict],
    body_type: str,
) -> float:
    """
    Score how well the outfit silhouette flatters the body type.
    Uses body_type.json rules mapped to descriptor fields.
    Returns 0.5 (neutral) when body type is unrecognised or descriptors are absent.
    """
    bt_key = _BT_ALIAS.get(body_type.lower().strip())
    if not bt_key:
        return 0.5
    rules = _BT_RULES.get(bt_key)
    if not rules:
        return 0.5

    good_fits     = rules["good_fits"]
    bad_fits      = rules["bad_fits"]
    good_necklines = rules["good_necklines"]
    bad_necklines  = rules["bad_necklines"]

    bonus   = 0
    penalty = 0
    checks  = 0

    for item in outfit_items:
        desc = item.get("descriptors") or {}
        fit  = (desc.get("fit") or "").lower()
        neck = (desc.get("neckline") or "").lower()
        sil  = (desc.get("silhouette") or "").lower()

        # Fit / silhouette check
        fit_val = fit or sil
        if fit_val:
            checks += 1
            if any(g in fit_val for g in good_fits):
                bonus += 1
            elif any(b in fit_val for b in bad_fits):
                penalty += 1

        # Neckline check (only for tops, dresses, jumpsuits, swimwear)
        cat = (item.get("category") or "").lower()
        if neck and cat in {"tops", "dresses", "jumpsuits", "swimwear", "set"}:
            checks += 1
            if any(g in neck for g in good_necklines):
                bonus += 1
            elif any(b in neck for b in bad_necklines):
                penalty += 1

    if checks == 0:
        return 0.5

    raw = 0.5 + 0.40 * (bonus / checks) - 0.30 * (penalty / checks)
    return round(max(0.2, min(1.0, raw)), 4)


def _score_flattery_proportion(
    outfit_items: List[Dict],
    height_cm: float,
) -> float:
    """
    Score proportion fit based on height (petite / average / tall).
    Uses body_proportion.json rules.
    Returns 0.5 for average heights or missing data.
    """
    if height_cm <= 0:
        return 0.5

    if height_cm < 160:
        proportion = "petite"
    elif height_cm > 178:
        proportion = "tall"
    else:
        return 0.5  # average height — no proportion penalty/bonus

    bonus   = 0
    penalty = 0
    checks  = 0

    for item in outfit_items:
        desc = item.get("descriptors") or {}
        fit  = (desc.get("fit") or "").lower()

        if not fit:
            continue
        checks += 1

        if proportion == "petite":
            # Petite: avoid oversized/wide silhouettes that swamp the frame
            _petite_bad = {"oversized", "boxy", "slouchy", "wide-leg", "wide",
                           "flare", "bootcut", "barrel", "voluminous"}
            _petite_good = {"fitted", "slim", "tailored", "skinny", "cropped"}
            if any(b in fit for b in _petite_bad):
                penalty += 1
            elif any(g in fit for g in _petite_good):
                bonus += 1

        else:  # tall
            # Tall: most silhouettes work; slight reward for proportional layering
            # No penalty — tall frames are versatile
            _tall_good = {"wide-leg", "oversized", "maxi", "long", "layered",
                          "flare", "bootcut", "barrel"}
            if any(g in fit for g in _tall_good):
                bonus += 1

    if checks == 0:
        return 0.5

    raw = 0.5 + 0.30 * (bonus / checks) - 0.30 * (penalty / checks)
    return round(max(0.2, min(1.0, raw)), 4)


def _score_flattery_neckline(
    outfit_items: List[Dict],
    body_type: Optional[str],
    shoulders: Optional[str],
) -> float:
    """
    Score neckline choices against body type and shoulder width.
    Uses neckline.json key_inputs logic.
    Returns 0.5 when no neckline data is found or no profile signals available.
    """
    # Build recommended/avoid sets from profile signals
    good_necklines: set = set()
    bad_necklines:  set = set()

    bt  = (body_type  or "").lower().strip()
    sh  = (shoulders  or "").lower().strip()

    # Body type signals
    if bt == "hourglass":
        good_necklines |= {"v-neck", "wrap", "sweetheart", "plunging"}
    if bt in {"apple", "round"}:
        good_necklines |= {"v-neck", "plunging", "deep-v", "scoop"}
        bad_necklines  |= {"crew", "turtleneck", "high-neck", "mock-neck"}
    if bt in {"pear", "triangle"}:
        good_necklines |= {"boat", "off-shoulder", "square", "bateau", "wide"}
    if bt in {"inverted_triangle", "inverted triangle", "inverted-triangle"}:
        good_necklines |= {"v-neck", "plunging", "scoop"}
        bad_necklines  |= {"boat", "off-shoulder", "square", "bateau"}

    # Shoulder signals (override / extend body type)
    if "broad" in sh:
        # V-neck draws the eye down and narrows; boat neckline widens — avoid
        good_necklines |= {"v-neck", "plunging", "deep-v", "scoop"}
        bad_necklines  |= {"boat", "off-shoulder", "bateau"}
    if "narrow" in sh:
        # Horizontal necklines add perceived width
        good_necklines |= {"boat", "off-shoulder", "square", "wide", "bateau"}

    if not good_necklines and not bad_necklines:
        return 0.5  # no profile signals — neutral

    bonus   = 0
    penalty = 0
    checks  = 0

    for item in outfit_items:
        cat  = (item.get("category") or "").lower()
        if cat not in {"tops", "dresses", "jumpsuits", "swimwear", "set"}:
            continue
        desc = item.get("descriptors") or {}
        neck = (desc.get("neckline") or "").lower()
        if not neck:
            continue

        checks += 1
        if any(g in neck for g in good_necklines):
            bonus += 1
        elif any(b in neck for b in bad_necklines):
            penalty += 1

    if checks == 0:
        return 0.5

    raw = 0.5 + 0.40 * (bonus / checks) - 0.30 * (penalty / checks)
    return round(max(0.2, min(1.0, raw)), 4)


def _score_flattery_complexion(
    outfit_items: List[Dict],
    complexion: str,
) -> float:
    """
    Score outfit color palette against skin tone.
    Uses skin_tone.json recommended / avoid color categories.
    Returns 0.5 when complexion is unrecognised or items have no color data.
    """
    bucket = _complexion_bucket(complexion)
    if not bucket:
        return 0.5

    color_rules = _COMPLEXION_COLOR_MAP.get(bucket)
    if not color_rules:
        return 0.5

    recommended = color_rules["recommended"]
    avoid       = color_rules["avoid"]

    bonus   = 0
    penalty = 0
    checks  = 0

    for item in outfit_items:
        color = (item.get("color") or "").lower().strip()
        if not color:
            continue
        checks += 1
        if any(r in color for r in recommended):
            bonus += 1
        elif any(a in color for a in avoid):
            penalty += 1

    if checks == 0:
        return 0.5

    raw = 0.5 + 0.35 * (bonus / checks) - 0.25 * (penalty / checks)
    return round(max(0.2, min(1.0, raw)), 4)


def score_flattery(
    outfit_items: List[Dict],
    user_profile: Dict,
) -> Tuple[float, List[str]]:
    """
    Composite flattery score — how well the outfit suits the user physically.

    Sub-signals (all default to 0.5 when profile data or descriptors are absent):
      0.30 × body_type_score   — silhouette/fit vs body type  (body_type.json)
      0.25 × proportion_score  — height-based proportion       (body_proportion.json)
      0.25 × neckline_score    — neckline vs body/shoulders    (neckline.json)
      0.20 × complexion_score  — item colors vs skin tone      (skin_tone.json)

    Returns:
        (flattery_score, rule_tags) where rule_tags is a list of engine_tags
        from matched JSON rules (used to populate score_breakdown["tags"]).
    """
    body_type  = (user_profile.get("body_type")  or "").strip()
    height_cm  = float(user_profile.get("height_cm") or 0)
    complexion = (user_profile.get("complexion") or "").strip()
    shoulders  = (user_profile.get("shoulders")  or "").strip()

    bt_score   = _score_flattery_body_type(outfit_items, body_type)   if body_type  else 0.5
    prop_score = _score_flattery_proportion(outfit_items, height_cm)   if height_cm  else 0.5
    neck_score = _score_flattery_neckline(outfit_items, body_type, shoulders)
    comp_score = _score_flattery_complexion(outfit_items, complexion)  if complexion else 0.5

    flattery = round(
        0.30 * bt_score
        + 0.25 * prop_score
        + 0.25 * neck_score
        + 0.20 * comp_score,
        4,
    )
    flattery = max(0.0, min(1.0, flattery))

    # Collect engine_tags from matched JSON rules for breakdown tagging
    tags: List[str] = []
    if body_type:
        bt_key = _BT_ALIAS.get(body_type.lower())
        for rule in (_BODY_TYPE_RULES.get("rules") or []):
            if rule.get("subtype", "").lower().replace(" ", "_") == bt_key:
                tags.extend(rule.get("engine_tags") or [])
    if complexion:
        bucket = _complexion_bucket(complexion)
        for rule in (_SKIN_TONE_RULES.get("rules") or []):
            if rule.get("subtype", "").lower() == (bucket or ""):
                tags.extend(rule.get("engine_tags") or [])

    _debug_print_score(
        "flattery",
        outfit_items,
        body_type_score=bt_score,
        proportion_score=prop_score,
        neckline_score=neck_score,
        complexion_score=comp_score,
        flattery=flattery,
        body_type=body_type or "none",
        shoulders=shoulders or "none",
        complexion=complexion or "none",
        tags=",".join(tags) if tags else "none",
    )

    return flattery, tags


# ─────────────────────────────────────────────────────────────────────────────
# Polish scoring — finishing-piece quality (shoes, outerwear, jewelry, accessories)
# ─────────────────────────────────────────────────────────────────────────────

# ── Shoe type → formality window (min, max) ───────────────────────────────────
# Used to check whether the footwear formality matches the occasion.
_SHOE_FORMALITY: Dict[str, Tuple[float, float]] = {
    "stiletto":    (0.55, 1.00),
    "pump":        (0.45, 1.00),
    "heel":        (0.40, 1.00),
    "mule":        (0.25, 0.75),
    "loafer":      (0.20, 0.75),
    "oxford":      (0.30, 0.80),
    "flat":        (0.10, 0.65),
    "ballet":      (0.15, 0.65),
    "boot":        (0.20, 0.80),
    "ankle boot":  (0.25, 0.80),
    "sneaker":     (0.00, 0.40),
    "trainer":     (0.00, 0.35),
    "sandal":      (0.05, 0.55),
    "slide":       (0.00, 0.40),
    "flip":        (0.00, 0.25),
    "wedge":       (0.10, 0.65),
    "espadrille":  (0.05, 0.50),
}

# Shoe type → appropriate seasons (empty set = all seasons OK)
_SHOE_SEASONAL: Dict[str, set] = {
    "boot":       {"fall", "winter"},
    "ankle boot": {"fall", "winter"},
    "sandal":     {"spring", "summer"},
    "flip":       {"summer"},
    "espadrille": {"spring", "summer"},
}

# ── Outerwear type → formality window ────────────────────────────────────────
_OUTER_FORMALITY: Dict[str, Tuple[float, float]] = {
    "blazer":          (0.40, 1.00),
    "suit jacket":     (0.55, 1.00),
    "trench":          (0.35, 0.90),
    "coat":            (0.35, 1.00),
    "wool coat":       (0.40, 1.00),
    "leather jacket":  (0.05, 0.55),
    "denim jacket":    (0.00, 0.45),
    "cardigan":        (0.10, 0.65),
    "bomber":          (0.00, 0.45),
    "puffer":          (0.00, 0.35),
    "cape":            (0.30, 0.85),
    "shrug":           (0.10, 0.60),
    "vest":            (0.10, 0.70),
    "kimono":          (0.00, 0.50),
    "coverup":         (0.00, 0.40),
}

# ── Neckline → necklace pairing from jewelry.json ────────────────────────────
# Maps neckline keyword → recommended necklace styles (substring match on subtype)
_NECKLINE_NECKLACE: Dict[str, List[str]] = {
    "v-neck":       ["pendant", "drop"],
    "v neck":       ["pendant", "drop"],
    "plunging":     ["pendant", "drop"],
    "deep-v":       ["pendant", "drop"],
    "scoop":        ["delicate", "pendant"],
    "round":        ["dainty", "pendant"],
    "crew":         ["layered", "long"],
    "high-neck":    ["long", "lariat", "chain"],
    "turtleneck":   ["long", "lariat"],
    "mock-neck":    ["long", "chain"],
    "off-shoulder": ["statement", "choker"],
    "strapless":    ["choker", "statement"],
    "sweetheart":   ["pendant", "short"],
    "halter":       ["statement", "choker"],
    "boat":         ["pendant", "delicate"],
}


def _score_shoe_fit(outfit_items: List[Dict], occasion: Dict) -> float:
    """
    Score how well the footwear choice fits the occasion formality and season.
    Returns 0.5 (neutral) when no shoes are in the outfit or descriptors are absent.

    Scoring logic (from shoes.json factors):
      + Formality window match     → bonus
      − Formality window miss      → penalty (proportional to miss distance)
      + Seasonal appropriateness   → small bonus
      − Seasonal mismatch          → small penalty
      − Statement shoe on complex base → small penalty (complexity control)
    """
    shoes = [i for i in outfit_items if _normalize_category_name(i.get("category")) in {"shoes", "footwear"}]
    if not shoes:
        return 0.5  # no shoe in combo — neutral (diversity check handles completeness)

    occ_formality = occasion.get("formality_level", 0.5)
    occ_temp      = (occasion.get("temperature_context") or "").lower()
    event_tokens  = _occasion_token_set(occasion)
    occ_season    = "summer" if "warm" in occ_temp or "hot" in occ_temp else \
                    "winter" if "cold" in occ_temp or "cool" in occ_temp else ""
    is_walkable_outdoor = bool(_WALKABLE_OUTDOOR_TOKENS & event_tokens)
    is_comfort_occasion = bool(_COMFORT_OCCASION_TOKENS & event_tokens)
    is_comfort_first    = bool(_COMFORT_FIRST_TOKENS    & event_tokens)
    is_fashion_first    = bool(_FASHION_FIRST_TOKENS    & event_tokens)
    is_long_duration    = bool(_LONG_DURATION_TOKENS    & event_tokens)

    # Detect outfit complexity (for statement-shoe contrast control)
    non_shoe = [i for i in outfit_items if _normalize_category_name(i.get("category")) not in {"shoes", "footwear"}]
    has_pattern  = any((i.get("pattern") or "").lower() not in {"", "solid", "plain", "none"} for i in non_shoe)
    item_count   = len(non_shoe)
    outfit_is_busy = has_pattern or item_count >= 4

    total_score = 0.0
    for shoe in shoes:
        desc = shoe.get("descriptors") or {}
        shoe_type = (desc.get("shoe_type") or desc.get("heel_type") or "").lower().strip()
        shoe_color = (shoe.get("color") or "").lower().strip()
        shoe_pattern = (shoe.get("pattern") or "").lower().strip()
        signals = _shoe_signals(shoe)

        score = 0.5  # base neutral

        # Formality window check — also try item_type as fallback key when shoe_type
        # is a generic label like "strappy" that doesn't appear in _SHOE_FORMALITY
        item_type_key = (shoe.get("item_type") or "").lower().strip()
        window = None
        for key, win in _SHOE_FORMALITY.items():
            if key in shoe_type or key in item_type_key:
                window = win
                break
        if window:
            lo, hi = window
            if lo <= occ_formality <= hi:
                score += 0.30  # within window — bonus
            else:
                miss = min(abs(occ_formality - lo), abs(occ_formality - hi))
                score -= min(0.30, miss * 0.60)  # proportional penalty

        # Seasonal check
        for key, seasons in _SHOE_SEASONAL.items():
            if key in shoe_type and occ_season and occ_season not in seasons:
                score -= 0.12  # seasonal mismatch
                break

        # Statement control: bold/printed shoes on already-busy outfit
        is_statement_shoe = shoe_pattern not in {"", "solid", "plain", "none"}
        if is_statement_shoe and outfit_is_busy:
            score -= 0.10

        # Walkable outdoor contexts strongly prefer practical shoes.
        # Penalty is intentionally large — heels at park/picnic/hiking are a clear
        # contextual mismatch regardless of aesthetic compatibility.
        if is_walkable_outdoor:
            if signals["is_heel"]:
                score -= 0.35   # strong: heels at walkable outdoor are impractical
            elif signals["is_sneaker"]:
                score += 0.22   # sneakers are the contextually correct choice
            elif signals["is_walkable"]:
                score += 0.14   # flats/sandals are fine too

        # Explicit "Comfort" brief preference (not already covered by walkable_outdoor)
        elif is_comfort_first:
            if signals["is_heel"]:
                score -= 0.20
            elif signals["is_sneaker"]:
                score += 0.14
            elif signals["is_walkable"]:
                score += 0.08

        # Remaining comfort-signal layer (casual keywords, grass, etc.)
        elif is_comfort_occasion:
            if signals["is_heel"]:
                score -= 0.18
            elif signals["is_sneaker"]:
                score += 0.12
            elif signals["is_walkable"]:
                score += 0.08

        # "Fashion" brief preference: relax heel penalties (user is dressing up intentionally)
        if is_fashion_first and signals["is_heel"]:
            score += 0.10   # partial lift — offsets comfort-occasion penalties

        # Long-duration events compound the comfort need regardless of venue type
        if is_long_duration and signals["is_heel"]:
            score -= 0.12   # extra penalty on top of whatever applied above

        total_score += max(0.1, min(1.0, score))

    return round(total_score / len(shoes), 4)


def _score_outerwear_fit(outfit_items: List[Dict], occasion: Dict) -> float:
    """
    Score how well the outerwear layer fits the occasion formality and base outfit.
    Returns 0.65 (slightly positive) when no outerwear is present — it's optional.

    Scoring logic (from outerwear.json):
      + Formality window match     → bonus
      − Formality window miss      → penalty
      − Heavy outerwear in summer  → penalty
      − Statement outerwear on busy base → penalty (complexity control)
    """
    outer_items = [i for i in outfit_items if _normalize_category_name(i.get("category")) == "outerwear"]
    if not outer_items:
        return 0.65  # no outerwear — slightly positive (intentional, not a penalty)

    occ_formality = occasion.get("formality_level", 0.5)
    occ_temp = (occasion.get("temperature_context") or "").lower()
    is_hot   = "warm" in occ_temp or "hot" in occ_temp

    # Base outfit complexity
    non_outer = [i for i in outfit_items if _normalize_category_name(i.get("category")) != "outerwear"]
    has_pattern = any((i.get("pattern") or "").lower() not in {"", "solid", "plain", "none"} for i in non_outer)

    _HEAVY_OUTER_TYPES = {"coat", "wool coat", "puffer", "leather jacket", "trench"}

    total_score = 0.0
    for item in outer_items:
        desc = item.get("descriptors") or {}
        outer_type = (desc.get("outerwear_type") or desc.get("jacket_type") or "").lower().strip()
        outer_color = (item.get("color") or "").lower().strip()
        outer_pattern = (item.get("pattern") or "").lower().strip()

        score = 0.5

        # Formality window check
        window = None
        for key, win in _OUTER_FORMALITY.items():
            if key in outer_type:
                window = win
                break
        if window:
            lo, hi = window
            if lo <= occ_formality <= hi:
                score += 0.28
            else:
                miss = min(abs(occ_formality - lo), abs(occ_formality - hi))
                score -= min(0.28, miss * 0.55)

        # Heavy outerwear in hot/warm weather → clear mismatch
        is_heavy = any(h in outer_type for h in _HEAVY_OUTER_TYPES)
        if is_heavy and is_hot:
            score -= 0.18

        # Statement outerwear on already-complex base → complexity overload
        is_bold_outer = outer_pattern not in {"", "solid", "plain", "none"} or \
                        outer_color not in _NEUTRAL_COLORS
        if is_bold_outer and has_pattern:
            score -= 0.10

        total_score += max(0.1, min(1.0, score))

    return round(total_score / len(outer_items), 4)


def _score_jewelry_fit(outfit_items: List[Dict], occasion: Dict) -> float:
    """
    Score jewelry choices against neckline pairing rules and occasion appropriateness.
    Uses jewelry.json neckline_rules, earring_rules, and occasion signals.
    Returns 0.65 (neutral-positive) when no jewelry is present.

    Scoring logic:
      + Necklace matches recommended neckline pairing  → bonus
      − Necklace conflicts with neckline               → penalty
      + Earring choice matches outfit complexity/occasion → bonus
      − Statement earrings + statement necklace simultaneously → overload penalty
    """
    jewelry = [i for i in outfit_items
               if (i.get("accessory_subtype") or i.get("category") or "").lower()
               in {"necklace", "earrings", "bracelet", "ring", "jewelry"}
               or _normalize_category_name(i.get("category")) == "jewelry"]
    if not jewelry:
        return 0.65  # no jewelry — neutral, not a penalty

    # Find outfit neckline from top/dress/jumpsuit/swimwear
    outfit_neckline = ""
    for item in outfit_items:
        cat = _normalize_category_name(item.get("category"))
        if cat in {"tops", "dresses", "jumpsuits", "swimwear", "set"}:
            desc = item.get("descriptors") or {}
            neck = (desc.get("neckline") or "").lower()
            if neck:
                outfit_neckline = neck
                break

    # Outfit complexity signal
    pattern_items = sum(1 for i in outfit_items
                        if (i.get("pattern") or "").lower() not in {"", "solid", "plain", "none"})
    outfit_is_busy = pattern_items >= 2 or len(outfit_items) >= 5

    occ_formality = occasion.get("formality_level", 0.5)
    is_formal = occ_formality >= 0.6

    # Classify jewelry pieces
    necklaces  = []
    earrings   = []
    other_jwl  = []
    for item in jewelry:
        sub = (item.get("accessory_subtype") or "").lower()
        desc = item.get("descriptors") or {}
        jwl_type = (desc.get("jewelry_type") or desc.get("type") or sub or "").lower()
        if "neck" in jwl_type or "pendant" in jwl_type or "chain" in jwl_type or "choker" in jwl_type:
            necklaces.append(item)
        elif "ear" in jwl_type or "earring" in jwl_type or "hoop" in jwl_type or "stud" in jwl_type:
            earrings.append(item)
        else:
            other_jwl.append(item)

    score = 0.65  # start at neutral-positive

    # Necklace × neckline pairing
    if necklaces and outfit_neckline:
        recommended_styles = []
        for neck_key, styles in _NECKLINE_NECKLACE.items():
            if neck_key in outfit_neckline:
                recommended_styles = styles
                break
        if recommended_styles:
            for necklace in necklaces:
                desc = necklace.get("descriptors") or {}
                n_type = (desc.get("jewelry_type") or desc.get("type") or
                          necklace.get("accessory_subtype") or "").lower()
                if any(s in n_type for s in recommended_styles):
                    score += 0.12
                else:
                    score -= 0.08

    # Statement overload check: statement earrings + statement necklace = too much
    has_statement_earring  = any(
        "statement" in (i.get("descriptors") or {}).get("jewelry_type", "").lower() or
        "chandelier" in (i.get("descriptors") or {}).get("jewelry_type", "").lower()
        for i in earrings
    )
    has_statement_necklace = any(
        "statement" in (i.get("descriptors") or {}).get("jewelry_type", "").lower()
        for i in necklaces
    )
    if has_statement_earring and has_statement_necklace:
        score -= 0.18  # competing focal points

    # Busy outfit → prefer minimal jewelry
    if outfit_is_busy and (has_statement_earring or has_statement_necklace):
        score -= 0.10

    # Formal occasion → reward pearl/diamond/fine jewelry (engine_tags: luxury_boost, refined)
    if is_formal:
        for item in jewelry:
            desc = item.get("descriptors") or {}
            material = (desc.get("material") or desc.get("metal") or "").lower()
            if any(m in material for m in {"pearl", "diamond", "gold", "platinum"}):
                score += 0.08
                break

    return round(max(0.1, min(1.0, score)), 4)


def _score_accessory_balance(outfit_items: List[Dict], occasion: Dict) -> float:
    """
    Score accessory balance using accessories.json constraint rules.
    Checks: statement piece count, complexity matching, occasion fit, matchy-matchy.
    Returns 0.65 (neutral-positive) when no accessories are present.

    Constraints enforced:
      Too Many Statement Pieces → penalty if > 1 bold focal accessory
      Ignoring Outfit Complexity → penalty if busy accessories on busy outfit
      Wrong Occasion → penalty if casual accessory at formal event
      Matchy-Matchy → small penalty if bag + jewelry exact same bold color
    """
    accessories = [i for i in outfit_items
                   if _normalize_category_name(i.get("category")) == "accessories"
                   or (i.get("accessory_subtype") or "").lower()
                   in {"bag", "hat", "sunglasses", "scarf", "belt", "watch"}]
    if not accessories:
        return 0.65  # no accessories — neutral

    occ_formality = occasion.get("formality_level", 0.5)
    is_formal  = occ_formality >= 0.65
    is_casual  = occ_formality <= 0.35

    # Core outfit complexity
    core_items = [i for i in outfit_items
                  if _normalize_category_name(i.get("category")) not in {"accessories", "jewelry"}]
    outfit_is_busy = sum(1 for i in core_items
                         if (i.get("pattern") or "").lower()
                         not in {"", "solid", "plain", "none"}) >= 2

    # Classify accessories
    def _is_statement_accessory(item: Dict) -> bool:
        color   = (item.get("color") or "").lower()
        pattern = (item.get("pattern") or "").lower()
        sub     = (item.get("accessory_subtype") or "").lower()
        desc    = item.get("descriptors") or {}
        style   = (desc.get("style") or "").lower()
        return (
            pattern not in {"", "solid", "plain", "none"}
            or color not in _NEUTRAL_COLORS
            or "statement" in style
            or "bold" in style
        )

    def _is_casual_accessory(item: Dict) -> bool:
        sub = (item.get("accessory_subtype") or "").lower()
        return sub in {"sunglasses", "hat", "snapback", "cap", "beanie"}

    statement_count = sum(1 for a in accessories if _is_statement_accessory(a))
    casual_formal_clash = is_formal and any(_is_casual_accessory(a) for a in accessories)

    score = 0.65  # start at neutral-positive

    # Constraint: Too Many Statement Pieces
    if statement_count > 2:
        score -= 0.15 * (statement_count - 2)

    # Constraint: Ignoring Outfit Complexity
    if outfit_is_busy and statement_count >= 1:
        score -= 0.10

    # Constraint: Wrong Occasion (casual accessory at formal)
    if casual_formal_clash:
        score -= 0.12

    # Constraint: No Contrast — flat monochrome finish
    # If everything (core + accessories) is in neutral colors only, add small nudge
    all_colors = [(i.get("color") or "").lower() for i in outfit_items if i.get("color")]
    all_neutral = all(c in _NEUTRAL_COLORS or not c for c in all_colors)
    if all_neutral and len(all_colors) >= 3:
        score -= 0.06  # too flat — slight nudge

    # Positive: well-matched accessory count for occasion
    if is_casual and 1 <= len(accessories) <= 3:
        score += 0.08
    elif is_formal and 1 <= len(accessories) <= 2:
        score += 0.08

    return round(max(0.1, min(1.0, score)), 4)


def score_polish(
    outfit_items: List[Dict],
    occasion: Dict,
) -> Tuple[float, List[str]]:
    """
    Composite finishing-piece quality score — how well shoes, outerwear,
    jewelry, and accessories work together and with the occasion.

    Sub-signals:
      0.35 × shoe_fit         — formality/season alignment   (shoes.json)
      0.30 × outerwear_fit    — formality/weather/complexity  (outerwear.json)
      0.20 × jewelry_fit      — neckline pairing + overload   (jewelry.json)
      0.15 × accessory_balance — statement control + occasion  (accessories.json)

    All sub-scores default to neutral/positive when the piece type is absent,
    so outfits without optional layers are not penalised.

    Returns:
        (polish_score, engine_tags)
    """
    shoe_score  = _score_shoe_fit(outfit_items, occasion)
    outer_score = _score_outerwear_fit(outfit_items, occasion)
    jewel_score = _score_jewelry_fit(outfit_items, occasion)
    acc_score   = _score_accessory_balance(outfit_items, occasion)

    polish = round(
        0.35 * shoe_score
        + 0.30 * outer_score
        + 0.20 * jewel_score
        + 0.15 * acc_score,
        4,
    )
    polish = max(0.0, min(1.0, polish))

    # Collect engine_tags from JSON assets for scored categories
    tags: List[str] = []
    for rule in (_SHOES_RULES.get("rules") or []):
        for item in outfit_items:
            desc = item.get("descriptors") or {}
            shoe_t = (desc.get("shoe_type") or "").lower()
            if any(k in rule.get("subtype", "").lower() for k in shoe_t.split()):
                tags.extend(rule.get("engine_tags") or [])
                break
    for rule in (_OUTERWEAR_RULES.get("rules") or []):
        for item in outfit_items:
            desc = item.get("descriptors") or {}
            outer_t = (desc.get("outerwear_type") or "").lower()
            if any(k in rule.get("subtype", "").lower() for k in outer_t.split()):
                tags.extend(rule.get("engine_tags") or [])
                break

    _debug_print_score(
        "polish",
        outfit_items,
        shoe_fit=shoe_score,
        outerwear_fit=outer_score,
        jewelry_fit=jewel_score,
        accessory_balance=acc_score,
        polish=polish,
        tags=",".join(tags) if tags else "none",
    )

    return polish, list(dict.fromkeys(tags))  # deduplicate while preserving order


# ─────────────────────────────────────────────────────────────────────────────
# V2 scoring — outfit-level intelligence
# ─────────────────────────────────────────────────────────────────────────────

def classify_color_story(items: List[Dict]) -> Tuple[float, str]:
    """
    Classify the outfit's color palette as a composed story and score it.
    Returns (score, label) where label is used as an explanation tag.

    Hierarchy:
      neutral base + single pop  → 0.92  (60-30-10 rule)
      all neutrals               → 0.88  (clean minimal)
      monochromatic              → 0.86  (tonal depth)
      analogous/tonal            → 0.84  (harmonious)
      complementary contrast     → 0.80  (bold but intentional)
      mixed                      → 0.70  (undefined story)
      clashing                   → 0.58  (high risk)
    """
    colors = [item.get("color", "").lower().strip() for item in items if item.get("color")]
    if not colors:
        return 0.70, "unknown palette"

    neutrals   = [c for c in colors if c in NEUTRAL_NAMES]
    chromatics = [c for c in colors if c not in NEUTRAL_NAMES]

    if not chromatics:
        return 0.88, "clean neutral palette"

    if len(chromatics) == 1:
        return 0.92, f"neutral base with {chromatics[0]} accent"

    unique = set(colors)
    if len(unique) == 1:
        return 0.86, f"monochromatic {colors[0]}"

    from services.taxonomy import get_color_rgb
    _color_rgb = get_color_rgb()
    rgb_vals = [_color_rgb.get(c) for c in chromatics if _color_rgb.get(c)]
    if len(rgb_vals) >= 2:
        hsl_vals = [_rgb_to_hsl(*rgb) for rgb in rgb_vals]
        hues = [h for h, s, _ in hsl_vals if s > 0.15]
        if len(hues) >= 2:
            max_diff = max(
                min(abs(h1 - h2), 360.0 - abs(h1 - h2))
                for h1, h2 in itertools.combinations(hues, 2)
            )
            if max_diff < 45:
                return 0.84, "tonal analogous palette"
            if 150 <= max_diff <= 210:
                return 0.80, "complementary contrast palette"
            if max_diff > 220:
                return 0.58, "clashing color mix"

    return 0.70, "mixed palette"


def _predict_outfit_attrs(
    items: List[Dict],
    occasion: Dict,
    compat_score: float,
    approp_score: float,
    novelty_score: float,
) -> Dict[str, str]:
    """
    Predict card attributes (vibe, color_theory, fit_check, trend_label) for an
    outfit using the same lightweight rule-based helpers as _build_outfit_card().

    Shared by score_attribute_match() and score_outfit_v2() (for trend scoring)
    so the prediction helpers only run once per outfit.
    """
    occasion_type = (occasion.get("occasion_type") or "casual").lower()
    formality     = float(occasion.get("formality_level") or 0.5)
    event_tokens  = list(occasion.get("event_tokens") or [])

    _, raw_color_label = classify_color_story(items)
    _, silhouette_tag  = score_silhouette_balance(items)
    _, trend_label     = _trend_stars_and_label(novelty_score, compat_score, approp_score, items)
    vibe               = _vibe_check(occasion_type, formality, event_tokens, raw_color_label, compat_score, items)
    color_theory       = _color_theory_label(raw_color_label, items)
    fit_check          = _fit_check_label(compat_score, silhouette_tag, items)

    return {
        "vibe":         vibe,
        "color_theory": color_theory,
        "fit_check":    fit_check,
        "trend_label":  trend_label,
    }


def score_attribute_match(
    items: List[Dict],
    occasion: Dict,
    compat_score: float,
    approp_score: float,
    novelty_score: float,
    attribute_prefs: Dict[str, Dict[str, float]],
) -> float:
    """
    Score how well this outfit's predicted card attributes align with the user's
    learned preference vector.

    Predicts vibe, color_theory, fit_check, and trend_label via
    _predict_outfit_attrs(), then looks up each value in the per-user
    attribute_prefs map.

    Returns 0.0–1.0.  Defaults to neutral 0.5 when prefs are absent or prediction fails.
    """
    if not attribute_prefs:
        return 0.5
    try:
        predicted = _predict_outfit_attrs(items, occasion, compat_score, approp_score, novelty_score)
        scores = []
        for attr, val in predicted.items():
            pref_map = attribute_prefs.get(attr)
            if pref_map and val:
                # 0.40 = slight below-neutral for unseen attribute values
                scores.append(pref_map.get(val, 0.40))
        return round(sum(scores) / len(scores), 4) if scores else 0.5
    except Exception:
        return 0.5


def score_user_style_centroid(
    items: List[Dict],
    user_style_centroid: Optional[List[float]],
) -> float:
    """
    Score how visually close this outfit is to the user's CLIP style centroid —
    the mean embedding of items from their highest-rated outfits.

    Uses cosine similarity between the outfit's mean embedding and the centroid.
    Normalises cosine similarity from [–1, 1] → [0, 1].

    Returns neutral 0.5 when the centroid or item embeddings are unavailable.
    """
    if not user_style_centroid:
        return 0.5
    vecs = [item.get("embedding_vector") for item in items if item.get("embedding_vector")]
    if not vecs:
        return 0.5
    dim        = len(vecs[0])
    outfit_emb = [sum(v[d] for v in vecs) / len(vecs) for d in range(dim)]
    raw_sim    = cosine_similarity(outfit_emb, user_style_centroid)   # in [–1, 1]
    return round((raw_sim + 1.0) / 2.0, 4)                            # → [0, 1]


def score_silhouette_balance(items: List[Dict]) -> Tuple[float, str]:
    """
    Score proportion balance using classic styling rules.
    When one piece is voluminous the other should be fitted (contrast = balance).
    Returns (score, reason_tag).

      oversized + fitted   → 0.95  (perfect proportion contrast)
      all fitted           → 0.88  (polished, consistent)
      one oversized only   → 0.82  (acceptable)
      two+ oversized       → 0.55  (double volume — risky)
      no descriptor data   → 0.75  (neutral)
    """
    cat_fits: Dict[str, str] = {}
    for item in items:
        cat = _normalize_category_name(item.get("category"))
        fit = ((item.get("descriptors") or {}).get("fit") or "").lower()
        if fit and cat in ("tops", "bottoms", "dresses", "jumpsuits", "outerwear", "set", "loungewear"):
            cat_fits[cat] = fit

    if len(cat_fits) < 2:
        return 0.75, "insufficient descriptor data for proportion check"

    oversized = {c for c, f in cat_fits.items() if any(v in f for v in _OVERSIZED_FITS)}
    fitted    = {c for c, f in cat_fits.items() if any(v in f for v in _FITTED_FITS)}

    if oversized and fitted:
        return 0.95, "balanced proportion — volume contrasted with fitted"
    if not oversized and len(fitted) >= 2:
        return 0.88, "consistently fitted silhouette"
    if len(oversized) == 1 and not fitted:
        return 0.82, "relaxed silhouette"
    if len(oversized) >= 2:
        return 0.55, "double-volume risk — multiple oversized pieces"
    return 0.75, "mixed proportions"


def score_pairwise_compatibility(item_a: Dict, item_b: Dict) -> float:
    """
    Score a specific pair of items for compatibility.
    Combines color harmony (60%) with inter-item formality match (40%).
    """
    color_score = score_color_compatibility(
        item_a.get("color", "black"),
        item_b.get("color", "black"),
    )
    f_a = item_a.get("formality_score", 0.5)
    f_b = item_b.get("formality_score", 0.5)
    formality_match = max(0.0, 1.0 - abs(f_a - f_b) / 0.5)
    return round(0.60 * color_score + 0.40 * formality_match, 4)


def score_compatibility(items: List[Dict]) -> Tuple[float, Dict[str, str]]:
    """
    Outfit-level compatibility: pairwise scores + color story + silhouette balance + pattern.
    Returns (score, tags) where tags feed the LLM explanation.
    """
    pairs = list(itertools.combinations(items, 2))
    pairwise_avg = (
        sum(score_pairwise_compatibility(a, b) for a, b in pairs) / len(pairs)
        if pairs else 0.75
    )

    color_story_score, color_story_tag = classify_color_story(items)
    silhouette_score,  silhouette_tag   = score_silhouette_balance(items)
    pattern_score = score_pattern_coherence(items)

    combined = (
        0.30 * pairwise_avg
        + 0.30 * color_story_score
        + 0.25 * silhouette_score
        + 0.15 * pattern_score
    )

    tags: Dict[str, str] = {
        "color_story":  color_story_tag,
        "silhouette":   silhouette_tag,
        "pattern_note": "clean lines" if pattern_score >= 0.85 else "bold pattern mix",
    }
    _debug_print_score(
        "compatibility",
        items,
        pairwise_avg=pairwise_avg,
        color_story_score=color_story_score,
        silhouette_score=silhouette_score,
        pattern_score=pattern_score,
        compatibility=combined,
        color_story=color_story_tag,
        silhouette=silhouette_tag,
    )
    return round(combined, 4), tags


def score_appropriateness_v2(items: List[Dict], occasion: Dict) -> Tuple[float, str]:
    """
    Extended occasion appropriateness: formality + season + venue fit + dress-code guard.
    Returns (score, reason_tag).
    """
    event_formality = occasion.get("formality_level", 0.5)
    temperature     = occasion.get("temperature_context", "")
    event_tokens    = _occasion_token_set(occasion)

    formality_score = sum(
        score_formality_alignment(item.get("formality_score", 0.5), event_formality)
        for item in items
    ) / len(items)

    season_score = sum(
        score_season_compatibility(item.get("season", "all"), temperature)
        for item in items
    ) / len(items)

    # Attribute-level season rules (fabric weight, sleeve, fit, pattern, insulation).
    # Blended with the existing metadata-based season_score: 40% metadata + 60% rules.
    try:
        from services.season_rules import score_season_rules as _score_season_rules
        rule_score   = _score_season_rules(items, occasion)
        season_score = round(0.40 * season_score + 0.60 * rule_score, 4)
    except Exception:
        pass  # fall back to original season_score unchanged

    _OUTDOOR_TOKENS = {"beach", "outdoor", "rooftop", "park", "garden", "hiking", "picnic", "market"}
    _FORMAL_TOKENS  = {"wedding", "gala", "cocktail", "black-tie", "blacktie", "interview", "conference",
                        "black tie", "cocktail"}   # includes brief dressCode tokens
    _BEACH_TOKENS   = {"beach", "pool", "swim", "resort"}

    is_outdoor          = bool(_OUTDOOR_TOKENS          & event_tokens)
    is_formal_event     = bool(_FORMAL_TOKENS           & event_tokens)
    is_beach            = bool(_BEACH_TOKENS            & event_tokens)
    is_walkable_outdoor = bool(_WALKABLE_OUTDOOR_TOKENS & event_tokens)
    is_minimalist_mood  = bool(_MINIMALIST_MOOD_TOKENS  & event_tokens)
    is_comfort_first    = bool(_COMFORT_FIRST_TOKENS    & event_tokens)
    is_professional     = bool(_PROFESSIONAL_AUDIENCE_TOKENS & event_tokens)

    venue_multiplier = 1.0
    for item in items:
        cat  = (item.get("category") or "").lower()
        desc = item.get("descriptors") or {}
        heel = (desc.get("heel_type") or "").lower()
        item_formality = item.get("formality_score", 0.5)
        pattern = (item.get("pattern") or "").lower()

        if is_outdoor and cat == "shoes" and any(h in heel for h in ("stiletto", "block heel", "heeled")):
            venue_multiplier = min(venue_multiplier, 0.80)
        if is_walkable_outdoor and cat == "shoes":
            shoe_signals = _shoe_signals(item)
            if shoe_signals["is_heel"]:
                venue_multiplier = min(venue_multiplier, 0.48)
        # Comfort-first brief: caps appropriateness for heels regardless of venue
        if is_comfort_first and cat == "shoes":
            shoe_signals = _shoe_signals(item)
            if shoe_signals["is_heel"]:
                venue_multiplier = min(venue_multiplier, 0.68)
        if is_formal_event and item_formality < 0.25:
            venue_multiplier = min(venue_multiplier, 0.55)
        if is_walkable_outdoor and cat in {"dresses", "jumpsuits", "set", "tops", "bottoms"} and item_formality >= 0.82:
            venue_multiplier = min(venue_multiplier, 0.76)

        # Minimalist mood brief: penalises busy patterns
        if is_minimalist_mood and pattern not in {"", "solid", "plain", "none"}:
            venue_multiplier = min(venue_multiplier, 0.82)

        # Professional audience: items below a floor formality get penalised
        if is_professional and item_formality < 0.35:
            venue_multiplier = min(venue_multiplier, 0.75)

        # Swimwear is only appropriate at beach/pool — penalise anywhere else
        if cat == "swimwear" and not is_beach:
            venue_multiplier = min(venue_multiplier, 0.30)
        # Loungewear is occasion-inappropriate outside home/casual contexts
        if cat == "loungewear" and (is_formal_event or event_formality > 0.55):
            venue_multiplier = min(venue_multiplier, 0.40)
        # ── Beach-specific venue penalties ────────────────────────────────
        if is_beach:
            fabric     = (desc.get("fabric_type") or desc.get("fabric") or "").lower()
            item_type  = (item.get("item_type") or "").lower()
            shoe_type  = (desc.get("shoe_type") or "").lower()
            silhouette = (desc.get("silhouette") or desc.get("fit") or "").lower()
            # Heavy/winter fabrics are uncomfortable and look out of place at beach
            if fabric in {"denim", "leather", "suede", "tweed", "wool", "fleece", "faux_fur", "faux fur"}:
                venue_multiplier = min(venue_multiplier, 0.75)
            # Closed-toe athletic shoes (sneakers, trainers, boots) at beach
            if cat == "shoes" and any(k in item_type or k in shoe_type
                                      for k in ("sneaker", "trainer", "boot", "loafer", "oxford", "pump")):
                venue_multiplier = min(venue_multiplier, 0.72)
            # Structured / formal silhouettes are incongruous at beach
            if any(k in silhouette or k in item_type
                   for k in ("corset", "blazer", "tailored", "structured")):
                venue_multiplier = min(venue_multiplier, 0.70)

    venue_score = venue_multiplier

    # ── Beach affinity bonus: reward beachwear-first ordering ─────────────────
    # Swimwear outfits score higher than generic casual outfits at beach/pool.
    beach_affinity_bonus = 0.0
    if is_beach:
        _LIGHT_BEACH_FABRICS = {"linen", "cotton", "chiffon", "rayon", "bamboo", "mesh"}
        _BEACH_SHOE_TYPES    = {"sandal", "flip", "slide", "espadrille", "mule", "flat"}
        has_swimwear    = any((i.get("category") or "").lower() == "swimwear" for i in items)
        light_fabric_ct = sum(
            1 for i in items
            if (i.get("descriptors") or {}).get("fabric_type", "") in _LIGHT_BEACH_FABRICS
            or (i.get("descriptors") or {}).get("fabric", "") in _LIGHT_BEACH_FABRICS
        )
        has_beach_shoes = any(
            (i.get("category") or "").lower() == "shoes"
            and any(
                k in (i.get("descriptors") or {}).get("shoe_type", "").lower()
                or k in (i.get("item_type") or "").lower()
                for k in _BEACH_SHOE_TYPES
            )
            for i in items
        )
        if has_swimwear:
            beach_affinity_bonus += 0.30   # swimwear is primary beachwear — strong lift
        if light_fabric_ct >= 2:
            beach_affinity_bonus += 0.10   # majority light fabrics → breezy, appropriate
        elif light_fabric_ct == 1:
            beach_affinity_bonus += 0.05
        if has_beach_shoes:
            beach_affinity_bonus += 0.10   # sandals/slides over closed-toe shoes
        beach_affinity_bonus = min(beach_affinity_bonus, 0.35)  # cap so it can't dominate

    if formality_score >= 0.85:
        label = "strong formality match"
    elif formality_score >= 0.65:
        label = "appropriate for occasion"
    elif formality_score >= 0.45:
        label = "slight formality mismatch"
    else:
        label = "formality mismatch risk"

    # Beach affinity bonus is added directly to the combined score so it isn't
    # swallowed by the venue_score cap (swimwear at beach already has venue_score=1.0).
    # Base combined often already reaches 1.0 for appropriate beach outfits, so we
    # allow the score to exceed 1.0 here — the caller clips to [0, 1] via WEIGHTS_V2
    # multiplication rather than a hard cap at this stage.
    # A swimwear + sandals outfit (bonus=0.35, mult=0.50 → +0.175) will land ~1.175
    # vs a cotton casual outfit (bonus=0.15, mult=0.50 → +0.075) at ~1.075, giving
    # swimwear a clear +0.10 appropriateness advantage at beach events.
    combined = 0.50 * formality_score + 0.25 * season_score + 0.25 * venue_score
    combined = combined + beach_affinity_bonus * 0.50  # ← removed min(1.0) cap; multiplier raised 0.25→0.50
    combined = round(combined, 4)
    _debug_print_score(
        "appropriateness",
        items,
        formality_score=formality_score,
        season_score=season_score,
        venue_score=venue_score,
        beach_affinity_bonus=beach_affinity_bonus,
        appropriateness=combined,
        label=label,
    )
    return combined, label


def score_novelty(items: List[Dict], outfit_history_embeddings: List[List[float]]) -> float:
    """
    1 − max_cosine_similarity(current_outfit_embedding, past_outfit_embeddings).
    Returns 0.80 (slightly below max) when there is no history — leaves room for diversity.
    """
    if not outfit_history_embeddings:
        return 0.80

    vecs = [item.get("embedding_vector") for item in items if item.get("embedding_vector")]
    if not vecs:
        return 0.75

    dim = len(vecs[0])
    current_emb = [sum(v[d] for v in vecs) / len(vecs) for d in range(dim)]

    max_sim = max(
        (cosine_similarity(current_emb, past) for past in outfit_history_embeddings if past),
        default=0.0,
    )
    # Normalize cosine similarity from [-1,1] → [0,1] then invert for novelty
    novelty = 1.0 - (max_sim + 1.0) / 2.0
    novelty = round(max(0.0, min(1.0, novelty)), 4)
    _debug_print_score(
        "novelty",
        items,
        max_history_similarity=max_sim,
        novelty=novelty,
    )
    return novelty


def score_diversity_completeness(items: List[Dict], occasion: Dict) -> Tuple[float, str]:
    """
    Completeness bonus: reward outfits that cover expected slots for the occasion formality.
    Returns (score, label).
    """
    event_formality = occasion.get("formality_level", 0.5)
    categories  = {_normalize_category_name(i.get("category")) for i in items}
    item_types  = {_normalize_category_name(i.get("item_type"))  for i in items}

    has_top     = "tops"      in categories
    has_bottom  = "bottoms"   in categories
    has_dress   = bool({"dresses", "jumpsuits"} & categories)
    has_set     = "set"       in categories   # co-ord set covers top + bottom slot
    has_swim    = "swimwear"  in categories
    has_shoes   = "shoes"     in categories or "footwear" in item_types
    has_outer   = "outerwear" in categories

    core_complete = (has_top and has_bottom) or has_dress or has_set or has_swim

    event_tokens = set(occasion.get("event_tokens") or [])
    is_beach = bool({"beach", "pool", "swim", "resort"} & event_tokens)

    if has_swim and is_beach and has_outer:
        _debug_print_score("diversity", items, diversity=0.9, label="complete beach look")
        return 0.9, "complete beach look"
    if has_swim and is_beach:
        _debug_print_score("diversity", items, diversity=0.82, label="complete swim look")
        return 0.82, "complete swim look"
    if core_complete and has_shoes and has_outer and event_formality >= 0.4:
        _debug_print_score("diversity", items, diversity=0.95, label="complete layered look")
        return 0.95, "complete layered look"
    if core_complete and has_shoes:
        _debug_print_score("diversity", items, diversity=0.85, label="complete look")
        return 0.85, "complete look"
    if core_complete and not has_shoes:
        _debug_print_score("diversity", items, diversity=0.65, label="missing footwear")
        return 0.65, "missing footwear"
    _debug_print_score("diversity", items, diversity=0.50, label="incomplete outfit")
    return 0.50, "incomplete outfit"


def score_risk_penalty(items: List[Dict], occasion: Dict) -> Tuple[float, str]:
    """
    Risk penalty to be SUBTRACTED from the final score.
    Returns (penalty 0–0.5, reason_tag).
    """
    event_tokens    = _occasion_token_set(occasion)
    event_formality = occasion.get("formality_level", 0.5)

    _FORMAL_EVENTS = {"wedding", "gala", "cocktail", "black-tie", "blacktie"}
    is_formal = bool(_FORMAL_EVENTS & event_tokens)

    penalty = 0.0
    reasons: List[str] = []

    _BEACH_TOKENS = {"beach", "pool", "swim", "resort"}
    is_beach            = bool(_BEACH_TOKENS            & event_tokens)
    is_walkable_outdoor = bool(_WALKABLE_OUTDOOR_TOKENS & event_tokens)
    is_minimalist_mood  = bool(_MINIMALIST_MOOD_TOKENS  & event_tokens)
    is_comfort_first    = bool(_COMFORT_FIRST_TOKENS    & event_tokens)
    is_long_duration    = bool(_LONG_DURATION_TOKENS    & event_tokens)

    for item in items:
        cat = (item.get("category") or "").lower()
        item_formality = item.get("formality_score", 0.5)
        pattern = (item.get("pattern") or "").lower()

        if is_formal and item_formality < 0.20:
            penalty += 0.25
            reasons.append("casual/athletic piece at formal event")
        if event_formality < 0.50 and item_formality > 0.90:
            penalty += 0.12
            reasons.append("over-dressed for occasion")
        if not item.get("descriptors") and not item.get("color"):
            penalty += 0.04
            reasons.append("low-confidence item data")
        # Swimwear outside beach/pool context is a significant dress-code violation
        if cat == "swimwear" and not is_beach:
            penalty += 0.35
            reasons.append("swimwear outside beach/pool context")
        # Loungewear at any semi-formal or formal occasion
        if cat == "loungewear" and event_formality > 0.40:
            penalty += 0.20
            reasons.append("loungewear inappropriate for occasion formality")
        if is_walkable_outdoor and cat == "shoes":
            shoe_signals = _shoe_signals(item)
            if shoe_signals["is_heel"]:
                penalty += 0.25
                reasons.append("heels for walking/outdoor venue")
        if is_walkable_outdoor and cat in {"dresses", "jumpsuits", "set", "tops", "bottoms"} and item_formality > 0.88:
            penalty += 0.10
            reasons.append("too dressy for a walkable outdoor setting")
        # Minimalist mood brief: busy patterns break the stated intention
        if is_minimalist_mood and pattern not in {"", "solid", "plain", "none"}:
            penalty += 0.08
            reasons.append("busy pattern conflicts with minimalist brief")
        # Comfort-first or long-duration: heels accumulate an additional flag
        if (is_comfort_first or is_long_duration) and cat == "shoes":
            shoe_signals = _shoe_signals(item)
            if shoe_signals["is_heel"]:
                penalty += 0.10
                reasons.append("heels against comfort-first or extended-duration brief")
        # ── Beach-specific risk penalties ──────────────────────────────────
        if is_beach:
            desc_b     = item.get("descriptors") or {}
            fabric_b   = (desc_b.get("fabric_type") or desc_b.get("fabric") or "").lower()
            item_type_b = (item.get("item_type") or "").lower()
            shoe_type_b = (desc_b.get("shoe_type") or "").lower()
            silhouette_b = (desc_b.get("silhouette") or desc_b.get("fit") or "").lower()
            # Denim (jeans, denim jacket) at beach
            if fabric_b == "denim":
                penalty += 0.12
                reasons.append("denim at beach/pool")
            # Heavy fabrics (leather, wool, etc.) at beach
            if fabric_b in {"leather", "suede", "wool", "tweed", "fleece"}:
                penalty += 0.10
                reasons.append("heavy fabric at beach")
            # Closed-toe athletic or formal shoes at beach
            if cat == "shoes" and any(k in item_type_b or k in shoe_type_b
                                      for k in ("sneaker", "trainer", "boot", "oxford", "pump")):
                penalty += 0.10
                reasons.append("closed-toe shoes at beach/pool")
            # Structured/formal silhouettes at beach
            if any(k in silhouette_b or k in item_type_b
                   for k in ("corset", "blazer", "suit")):
                penalty += 0.15
                reasons.append("formal/structured piece at beach")

    penalty = min(penalty, 0.50)
    label   = "; ".join(reasons) if reasons else "no significant risk"
    penalty = round(penalty, 4)
    _debug_print_score(
        "risk_penalty",
        items,
        risk_penalty=penalty,
        reasons=label,
    )
    return penalty, label


def score_outfit_v2(
    outfit_items:              List[Dict],
    occasion:                  Dict,
    user_feedback_weight:      float = 0.5,
    user_body_type:            Optional[str] = None,
    outfit_history_embeddings: Optional[List[List[float]]] = None,
    attribute_prefs:           Optional[Dict[str, Dict[str, float]]] = None,
    user_style_centroid:       Optional[List[float]] = None,
    user_profile:              Optional[Dict] = None,
) -> Tuple[float, Dict]:
    """
    V2 composite scorer — outfit-level intelligence.

    Returns (composite_score, score_breakdown) where score_breakdown contains
    per-component scores and human-readable tags used to seed the LLM explanation.

    event_appropriate score (E) — multi-dimensional event alignment:
      30% dress_code   — formality alignment vs event dress code
      25% mood         — item signals vs stated style mood (elegant/romantic/bold/…)
      20% time_of_day  — evening vs daytime item coding (hard veto when wrong)
      15% weather      — fabric/coverage/footwear vs weather conditions
      10% purpose      — occasion purpose fit (date night, dinner, party, work…)
    Hard veto: dress_code < 0.40 OR (time specified AND time_of_day < 0.35) → score 0.0
    See services/event_appropriate.py for full implementation.

    Preference score is a four-signal composite:
      25% combo-level feedback weight   (exact item combo reputation)
      25% body-type fit priors          (silhouette + descriptor match)
      25% attribute-level preferences   (vibe / color_theory / fit_check / trend_label)
      25% CLIP style centroid proximity (mean embedding of highly-rated items)
    Each signal defaults to neutral 0.5 when data is unavailable.

    Flattery score is a four-signal composite:
      30% body_type_score   — silhouette/fit vs body type  (body_type.json)
      25% proportion_score  — height-based proportion       (body_proportion.json)
      25% neckline_score    — neckline vs body/shoulders    (neckline.json)
      20% complexion_score  — item colors vs skin tone      (skin_tone.json)
    Each signal defaults to neutral 0.5 when profile data or descriptors are absent.

    Polish score is a four-signal composite:
      35% shoe_fit          — formality/season alignment    (shoes.json)
      30% outerwear_fit     — formality/weather/complexity  (outerwear.json)
      20% jewelry_fit       — neckline pairing + overload   (jewelry.json)
      15% accessory_balance — statement control + occasion  (accessories.json)
    All sub-scores default to neutral/positive when piece type is absent.
    """
    # C — Compatibility
    compat_score, compat_tags = score_compatibility(outfit_items)

    # E — Event Appropriate (multi-dimensional event alignment — replaces single-axis A)
    from services.event_appropriate import score_event_appropriate
    ea_score, ea_dim_scores, ea_label = score_event_appropriate(outfit_items, occasion)

    # N — Novelty (computed before P and T so both can use real novelty signal)
    novelty_score = score_novelty(outfit_items, outfit_history_embeddings or [])

    # P — Preference (four-signal composite)
    body_score     = score_body_type_fit(outfit_items, user_body_type)
    # Pass ea_score in place of approp_score so attr_score prediction uses
    # the richer event alignment signal rather than old single-axis score.
    attr_score     = score_attribute_match(outfit_items, occasion, compat_score, ea_score,
                                           novelty_score, attribute_prefs or {})
    centroid_score = score_user_style_centroid(outfit_items, user_style_centroid)
    pref_score     = round(
        0.25 * user_feedback_weight
        + 0.25 * body_score
        + 0.25 * attr_score
        + 0.25 * centroid_score,
        4,
    )

    # F — Flattery (body type + proportion + neckline + complexion-color)
    flattery_score, flattery_tags = score_flattery(outfit_items, user_profile or {})

    # T — Trend (seasonal trend_calendar.json via trend_service)
    try:
        from services.trend_service import score_trend
        predicted_attrs = _predict_outfit_attrs(
            outfit_items, occasion, compat_score, ea_score, novelty_score
        )
        item_colors = _item_colors(outfit_items)
        trend_score = score_trend(item_colors, predicted_attrs)
    except Exception:
        trend_score = 0.50

    # D — Diversity/completeness
    diversity_score, diversity_label = score_diversity_completeness(outfit_items, occasion)

    # S — Polish (shoe + outerwear + jewelry + accessory finishing quality)
    polish_score, polish_tags = score_polish(outfit_items, occasion)

    # R — Risk penalty (subtracted)
    risk_penalty, risk_label = score_risk_penalty(outfit_items, occasion)

    composite = (
        WEIGHTS_V2["compatibility"]     * compat_score
        + WEIGHTS_V2["event_appropriate"] * ea_score
        + WEIGHTS_V2["preference"]        * pref_score
        + WEIGHTS_V2["flattery"]          * flattery_score
        + WEIGHTS_V2["trend"]             * trend_score
        + WEIGHTS_V2["novelty"]           * novelty_score
        + WEIGHTS_V2["diversity"]         * diversity_score
        + WEIGHTS_V2["polish"]            * polish_score
        - RISK_WEIGHT                     * risk_penalty
    )
    composite = round(max(0.0, min(1.0, composite)), 4)

    _debug_print_score(
        "v2_preference",
        outfit_items,
        user_feedback_weight=user_feedback_weight,
        body_type_fit=body_score,
        attribute_match=attr_score,
        style_centroid=centroid_score,
        preference=pref_score,
    )

    _debug_print_score(
        "v2_composite",
        outfit_items,
        compatibility=compat_score,
        event_appropriate=ea_score,
        ea_dress_code=ea_dim_scores.get("dress_code"),
        ea_mood=ea_dim_scores.get("mood"),
        ea_time_of_day=ea_dim_scores.get("time_of_day"),
        ea_weather=ea_dim_scores.get("weather"),
        ea_purpose=ea_dim_scores.get("purpose"),
        preference=pref_score,
        flattery=flattery_score,
        trend=trend_score,
        novelty=novelty_score,
        diversity=diversity_score,
        polish=polish_score,
        risk_penalty=risk_penalty,
        composite=composite,
    )

    score_breakdown = {
        "compatibility":      round(compat_score, 3),
        "event_appropriate":  round(ea_score, 3),
        "event_dim_scores":   {k: round(v, 3) for k, v in ea_dim_scores.items()},
        "preference":         round(pref_score, 3),
        "flattery":           round(flattery_score, 3),
        "trend":              round(trend_score, 3),
        "novelty":            round(novelty_score, 3),
        "diversity":          round(diversity_score, 3),
        "polish":             round(polish_score, 3),
        "risk_penalty":       round(risk_penalty, 3),
        "composite":          composite,
        "tags": {
            **compat_tags,
            "occasion":       ea_label,
            "completeness":   diversity_label,
            "risk":           risk_label,
            "flattery_rules": flattery_tags,
            "polish_rules":   polish_tags,
        },
    }
    return composite, score_breakdown


# ─────────────────────────────────────────────────────────────────────────────
# Outfit card builder
# ─────────────────────────────────────────────────────────────────────────────

# Warm / cool color sets for tone detection
_WARM_COLORS = {"red", "orange", "yellow", "beige", "brown", "gold", "pink",
                "coral", "rust", "cream", "nude", "tan", "camel", "khaki",
                "burgundy", "maroon", "copper", "peach", "terracotta"}
_COOL_COLORS = {"blue", "green", "purple", "grey", "gray", "navy", "teal",
                "mint", "lavender", "white", "silver", "lilac", "cobalt",
                "sage", "olive", "emerald", "indigo", "steel", "charcoal"}

# Fabric → breathability bucket
_BREATHABLE_FABRICS  = {"cotton", "linen", "chiffon", "silk", "bamboo", "rayon", "satin"}
_INSULATING_FABRICS  = {"wool", "fleece", "velvet", "cashmere", "knit", "waffle-knit",
                        "sherpa", "faux-fur", "tweed", "corduroy"}

# Light vs heavy outerwear for layering
_LIGHT_OUTERWEAR  = {"blazer", "cardigan", "denim jacket", "bomber", "vest", "cape", "shrug", "coverup"}
_HEAVY_OUTERWEAR  = {"coat", "puffer", "trench", "overcoat", "leather jacket", "parka"}
_NEUTRAL_COLORS   = {"black", "white", "grey", "gray", "beige", "brown", "cream", "tan", "camel", "khaki", "ivory", "nude", "charcoal", "silver"}
_TITLE_COLOR_WORDS = {
    # Neutrals
    "black":      "Noir",
    "white":      "Ivory",
    "ivory":      "Ivory",
    "cream":      "Cream",
    "beige":      "Sand",
    "nude":       "Nude",
    "tan":        "Tan",
    "camel":      "Camel",
    "khaki":      "Khaki",
    "brown":      "Mocha",
    "chocolate":  "Mocha",
    "charcoal":   "Slate",
    "grey":       "Slate",
    "gray":       "Slate",
    "silver":     "Silver",
    # Warm
    "red":        "Rouge",
    "burgundy":   "Burgundy",
    "wine":       "Burgundy",
    "maroon":     "Burgundy",
    "oxblood":    "Burgundy",
    "coral":      "Coral",
    "rust":       "Rust",
    "terracotta": "Rust",
    "orange":     "Amber",
    "mustard":    "Honey",
    "yellow":     "Honey",
    "gold":       "Gilded",
    "pink":       "Rose",
    "blush":      "Blush",
    "mauve":      "Mauve",
    "dusty rose": "Blush",
    "fuchsia":    "Fuchsia",
    "hot pink":   "Fuchsia",
    # Cool
    "blue":       "Azure",
    "cobalt":     "Azure",
    "navy":       "Midnight",
    "midnight":   "Midnight",
    "electric blue": "Azure",
    "teal":       "Teal",
    "turquoise":  "Aqua",
    "aqua":       "Aqua",
    "mint":       "Mint",
    "green":      "Sage",
    "sage":       "Sage",
    "olive":      "Olive",
    "khaki green":"Olive",
    "army green": "Olive",
    "forest":     "Forest",
    "forest green": "Forest",
    "emerald":    "Emerald",
    "lime":       "Lime",
    "chartreuse": "Lime",
    "lavender":   "Lavender",
    "lilac":      "Lavender",
    "purple":     "Plum",
    "plum":       "Plum",
    "indigo":     "Plum",
    # Special
    "multicolor": "Mosaic",
    "leopard":    "Wild",
    "animal print": "Wild",
}


def _item_colors(items: List[Dict[str, Any]]) -> List[str]:
    colors: List[str] = []
    for item in items:
        raw = str(item.get("color") or "").strip().lower()
        if not raw or raw.startswith("#"):
            continue
        colors.append(raw)
    return colors


def _normalize_category_name(category: Any) -> str:
    raw = str(category or "").strip().lower()
    return {
        "jumpsuit":  "jumpsuits",
        "romper":    "jumpsuits",
        "playsuit":  "jumpsuits",
        # Swimwear spelling / spacing variants the tagger or manual correction may produce
        "swim wear": "swimwear",
        "swim":      "swimwear",
        "bathing suit": "swimwear",
        "swimsuit":  "swimwear",
        "bikini":    "swimwear",
        "monokini":  "swimwear",
        "tankini":   "swimwear",
    }.get(raw, raw)


# Descriptor keys that are ONLY present on swimwear items (assigned by the LLM
# describe_clothing call for swimwear category).  If an item carries either key
# it is swimwear regardless of how the category field is stored.
_SWIMWEAR_DESCRIPTOR_KEYS: Set[str] = {"swimwear_style", "coverage_level"}

# item_type tokens that identify swimwear when the category field is unreliable
_SWIMWEAR_ITYPE_TOKENS: Set[str] = {
    "swimsuit", "bikini", "monokini", "tankini", "swimwear",
    "swim dress", "one-piece swim", "swim top", "swim bottom",
    "bathing suit", "rash guard", "swim shorts", "boardshorts",
}


def _is_swimwear_piece(item: Dict) -> bool:
    """
    True when the item is swimwear, using three independent signals so that
    a miscategorised swimsuit (e.g. stored as 'tops' or 'set') is still caught.

    Signal priority:
      1. Normalised category field == "swimwear"
      2. Descriptor contains a swimwear-only key (swimwear_style / coverage_level)
         — these keys are ONLY written by the LLM for swimwear items.
      3. item_type contains an explicit swimwear keyword.
    """
    cat = _normalize_category_name(item.get("category"))
    if cat == "swimwear":
        return True
    desc = item.get("descriptors") or {}
    if _SWIMWEAR_DESCRIPTOR_KEYS & set(desc.keys()):
        return True
    itype = (item.get("item_type") or "").lower()
    if any(tok in itype for tok in _SWIMWEAR_ITYPE_TOKENS):
        return True
    return False


def _is_finishing_category(category: Any) -> bool:
    normalized = _normalize_category_name(category)
    return normalized in {"accessories", "jewelry"}


# ── Trend-o-meter ─────────────────────────────────────────────────────────────

def _trend_stars_and_label(novelty: float, compat: float, approp: float, items: List[Dict]) -> tuple:
    """
    Derive 1–5 star rating and label from scorer components.

    Weighted: novelty 40% + compat 35% + approp 25%.
    Returns (stars: int, label: str).
    """
    accessory_count = sum(1 for item in items if _is_finishing_category(item.get("category")))
    structured_bonus = 0.02 if any(_normalize_category_name(item.get("category")) in {"outerwear", "dresses", "jumpsuits", "set"} for item in items) else 0.0
    palette_bonus = 0.01 * min(2, len(set(_item_colors(items))) - 1)

    score = novelty * 0.40 + compat * 0.35 + approp * 0.25 + min(0.05, accessory_count * 0.015) + structured_bonus + max(0.0, palette_bonus)
    stars = max(1, min(5, round(score * 5)))

    if stars == 5:
        label = "Statement" if novelty >= 0.68 or accessory_count >= 2 else "Runway"
    elif stars == 4:
        label = "Trendy" if novelty >= 0.58 else "Elevated"
    elif stars == 3:
        label = "Classic" if compat >= 0.72 else "Current"
    elif stars == 2:
        label = "Basic" if approp >= 0.55 else "Safe"
    else:
        label = "Outdated"
    return stars, label


# ── Vibe Check ────────────────────────────────────────────────────────────────

_CORE_VIBE_MAP = [
    # (occasion_type_keywords, formality_range, color_signals) → (core_vibe, energy)
    # Formal / high formality
    ({"formal", "gala", "wedding"},       (0.80, 1.0),  None,         "Elegant",  "Confident"),
    # Business / smart-casual
    ({"business", "office", "interview"}, (0.60, 1.0),  None,         "Chic",     "Powerful"),
    # Party / night out — bold colors → Edgy; muted → Chic
    ({"party", "cocktail", "night"},      (0.50, 0.80), {"contrast"}, "Edgy",     "Confident"),
    ({"party", "cocktail", "night"},      (0.50, 0.80), None,         "Bold",     "Effortless"),
    # Date / romantic
    ({"date", "romantic", "dinner"},      (0.40, 0.75), None,         "Chic",     "Flirty"),
    # Brunch / social casual
    ({"brunch", "lunch", "friends"},      (0.20, 0.55), None,         "Playful",  "Effortless"),
    # Athletic
    ({"athletic", "gym", "workout"},      (0.00, 0.30), None,         "Minimal",  "Confident"),
    # Casual / vacation
    ({"beach", "vacation", "outdoor"},    (0.00, 0.40), None,         "Casual",   "Effortless"),
]


def _vibe_check(
    occasion_type: str,
    formality: float,
    event_tokens: List[str],
    raw_color_label: str,
    compat: float,
    items: List[Dict],
) -> str:
    """
    Derive a 'CoreVibe + Energy' string unique to this outfit.

    Uses occasion type, formality, event tokens, color contrast signal,
    and compatibility score so each outfit in the same event yields a
    different vibe when the outfits themselves differ.
    """
    tokens   = set(event_tokens or []) | {occasion_type.lower()}
    has_contrast = any(k in raw_color_label.lower()
                       for k in ("complementary", "clashing", "color block"))
    categories = {_normalize_category_name(item.get("category")) for item in items}
    fits = [((item.get("descriptors") or {}).get("fit") or "").lower() for item in items]
    accessory_count = sum(1 for item in items if _is_finishing_category(item.get("category")))
    has_outerwear = "outerwear" in categories
    has_full_look = bool({"dresses", "jumpsuits", "set", "swimwear", "loungewear"} & categories)
    fitted_count = sum(1 for fit in fits if any(token in fit for token in ("slim", "tailored", "bodycon", "fitted")))
    relaxed_count = sum(1 for fit in fits if any(token in fit for token in ("relaxed", "loose", "oversized", "wide")))

    if has_outerwear and formality >= 0.6:
        base = "Sharp" if "business" in tokens or "office" in tokens else "Polished"
    elif has_full_look and formality >= 0.45:
        base = "Refined"
    elif accessory_count >= 2 and has_contrast:
        base = "Statement"
    elif fitted_count >= 2:
        base = "Sleek"
    elif relaxed_count >= 1 and formality < 0.5:
        base = "Playful" if ({"friends", "brunch", "lunch"} & tokens) else "Off-Duty"
    else:
        base = ""

    # Walk the map — first match wins
    for occ_set, (f_min, f_max), color_sig, core, energy in _CORE_VIBE_MAP:
        if not (occ_set & tokens):
            continue
        if not (f_min <= formality <= f_max):
            continue
        if color_sig == {"contrast"} and not has_contrast:
            continue
        # Modulate energy by compat score so different outfit strengths show differently
        core = base or core
        if compat >= 0.88 and energy == "Effortless":
            energy = "Confident"
        elif accessory_count >= 2 and energy == "Effortless":
            energy = "Styled"
        elif relaxed_count >= 1 and energy == "Powerful":
            energy = "Easy"
        elif compat < 0.60 and energy == "Confident":
            energy = "Soft"
        return f"{core} + {energy}"

    # Fallback: derive from formality band alone
    if formality >= 0.75:
        base, nrg = base or "Elegant", "Powerful" if compat >= 0.80 else "Confident"
    elif formality >= 0.50:
        base, nrg = base or "Chic", "Confident" if compat >= 0.75 else "Soft"
    elif has_contrast:
        base, nrg = base or "Bold", "Confident"
    else:
        base, nrg = base or "Casual", "Effortless"
    return f"{base} + {nrg}"


# ── Color Theory ──────────────────────────────────────────────────────────────

def _color_theory_label(raw_color_label: str, items: List[Dict]) -> str:
    """
    Build a single human-readable Color Theory value.

    Format: "{Palette}" — e.g. "Neutral Base + Pop", "Monochrome", "Color Block".
    """
    raw = raw_color_label.lower()
    colors = _item_colors(items)
    unique_colors = list(dict.fromkeys(colors))
    warm_count = sum(1 for color in unique_colors if color in _WARM_COLORS)
    cool_count = sum(1 for color in unique_colors if color in _COOL_COLORS)
    neutral_count = sum(1 for color in unique_colors if color in _NEUTRAL_COLORS)

    if "neutral base with" in raw:
        if warm_count > cool_count:
            palette = "Warm Neutral Lift"
        elif cool_count > warm_count:
            palette = "Cool Neutral Lift"
        else:
            palette = "Neutral Base + Pop"
    elif "clean neutral" in raw or "all neutral" in raw:
        palette = "Layered Neutral" if len(unique_colors) > 1 else "Soft Neutral"
    elif "monochromatic" in raw:
        palette = "Monochrome"
    elif "tonal analogous" in raw or "analogous" in raw:
        palette = "Warm Analogous" if warm_count >= cool_count else "Cool Analogous"
    elif "complementary contrast" in raw:
        palette = "High Contrast" if len(unique_colors) >= 3 else "Soft Contrast"
    elif "clashing" in raw:
        palette = "Color Block"
    elif "mixed" in raw:
        palette = "Mixed Contrast" if warm_count and cool_count else "Mixed Tones"
    else:
        if warm_count and not cool_count:
            palette = "Warm Story"
        elif cool_count and not warm_count:
            palette = "Cool Story"
        elif neutral_count >= 2 and len(unique_colors) <= 2:
            palette = "Balanced Pairing"
        else:
            palette = "Eclectic"

    return palette


_ACCESSORY_CATS = {"accessories", "accessory", "jewelry", "bag"}

# All possible second-word choices for title deduplication fallback
_TITLE_SECOND_WORDS = [
    "Layering", "Poise", "Afterglow", "Power", "Contour",
    "Motion", "Ease", "Structure", "Edit", "Moment", "Statement",
]


def _look_title(
    items: List[Dict],
    occasion: Dict,
    fit_check: str,
    color_theory: str,
    used_titles: Optional[Set[str]] = None,
) -> str:
    # ── Dominant color: prefer core garment colors over accessories / bags ─────
    # Accessories (ivory belt, beige bag) should not override the outfit's
    # actual colour story, so we try core-garment colours first and fall back
    # to the full item list only when no core colour maps to a title word.
    core_items = [i for i in items if _normalize_category_name(i.get("category")) not in _ACCESSORY_CATS]
    all_items_ordered = core_items + [i for i in items if i not in core_items]

    core_colors = list(dict.fromkeys(_item_colors(core_items)))
    all_colors  = list(dict.fromkeys(_item_colors(all_items_ordered)))

    dominant = next((_TITLE_COLOR_WORDS[c] for c in core_colors if c in _TITLE_COLOR_WORDS), None)
    if not dominant:
        dominant = next((_TITLE_COLOR_WORDS[c] for c in all_colors if c in _TITLE_COLOR_WORDS), None)
    if not dominant:
        if "Contrast" in color_theory:   dominant = "Contrast"
        elif "Neutral" in color_theory:  dominant = "Neutral"
        else:                            dominant = "Curated"

    # ── Second word based on outfit character ─────────────────────────────────
    categories = {_normalize_category_name(item.get("category")) for item in items}
    tokens = set(occasion.get("event_tokens") or []) | {str(occasion.get("occasion_type") or "").lower()}

    if "outerwear" in categories and fit_check in {"Tailored", "Structured"}:
        second = "Layering"
    elif "dresses" in categories or "jumpsuits" in categories or "set" in categories:
        second = "Poise"
    elif {"party", "cocktail", "night"} & tokens:
        second = "Afterglow"
    elif {"business", "office", "interview"} & tokens:
        second = "Power"
    elif fit_check == "Snatched":
        second = "Contour"
    elif fit_check == "Flowing":
        second = "Motion"
    elif fit_check == "Relaxed":
        second = "Ease"
    elif fit_check == "Tailored":
        second = "Structure"
    else:
        second = "Edit"

    title = f"{dominant} {second}"

    # ── Deduplication: try alternate second words when title is already used ──
    if used_titles is not None and title in used_titles:
        # Try secondary color from the palette as new dominant
        for alt_color in core_colors + all_colors:
            alt_word = _TITLE_COLOR_WORDS.get(alt_color)
            if alt_word and alt_word != dominant:
                candidate = f"{alt_word} {second}"
                if candidate not in used_titles:
                    return candidate
        # Try alternate second words with original dominant
        for alt_second in _TITLE_SECOND_WORDS:
            if alt_second != second:
                candidate = f"{dominant} {alt_second}"
                if candidate not in used_titles:
                    return candidate
        # Ultimate fallback: keep original (rare edge case with tiny wardrobes)

    return title


def compute_look_title(items: List[Dict], occasion: Dict, fit_check: str, color_theory: str) -> str:
    """
    Public wrapper around _look_title for use by the router when back-filling
    stored suggestions that predate the look_title field.
    Identical output to freshly generated cards.
    """
    return _look_title(items, occasion, fit_check, color_theory)


# ── Fit Check ─────────────────────────────────────────────────────────────────

def _fit_check_label(compat: float, silhouette_tag: str, items: List[Dict]) -> str:
    """
    Single fit label derived from compatibility score + silhouette balance tag
    + item descriptor data so different outfits produce different values.
    """
    cats  = {(i.get("category") or "").lower() for i in items}
    fits  = [(i.get("descriptors") or {}).get("fit", "").lower() for i in items]
    has_outerwear = "outerwear" in cats

    n_bodycon = sum(1 for f in fits if "bodycon" in f or "second-skin" in f)
    n_fitted  = sum(1 for f in fits if any(v in f for v in _FITTED_FITS))
    n_oversized = sum(1 for f in fits if any(v in f for v in _OVERSIZED_FITS))
    n_flowing = sum(1 for f in fits if any(v in f for v in {"flowy", "flare", "flowing", "wide", "maxi"}))

    # Layered always wins when outerwear is present
    if has_outerwear:
        return "Structured"

    # Bodycon is the most specific — check first
    if n_bodycon >= 1:
        return "Snatched" if compat >= 0.75 else "Bodycon"

    # High compatibility + all fitted = Snatched
    if compat >= 0.85 and n_fitted >= 2:
        return "Snatched"

    # Tailored: business/smart look with fitted pieces
    if n_fitted >= 1 and n_oversized == 0 and not n_flowing:
        return "Tailored" if compat >= 0.70 else "Structured"

    # Flowing / relaxed silhouette
    if n_flowing >= 1 or n_oversized >= 2:
        return "Flowing" if n_flowing > n_oversized else "Relaxed"

    # Contrast silhouette (volume + fitted)
    if n_oversized >= 1 and n_fitted >= 1:
        return "Structured"

    # Fallback on raw compat
    if compat >= 0.80: return "Snatched"
    if compat >= 0.65: return "Tailored"
    return "Relaxed"


# ── Weather Sync ──────────────────────────────────────────────────────────────

def _weather_sync_label(
    approp: float,
    temp: str,
    setting: str,
    items: List[Dict],
) -> str:
    """
    Build 'MatchLevel (Setting / TempLabel)' string.

    Match level from appropriateness score; setting + temp from occasion;
    layer hint from whether outerwear is present.
    """
    # Match level
    if approp >= 0.82:   match = "Perfect"
    elif approp >= 0.65: match = "Good"
    elif approp >= 0.45: match = "Risky"
    else:                match = "Not Suitable"

    # Setting label
    setting_label = setting.title() if setting else "Indoor"

    # Temperature label
    temp_labels = {
        "hot":  "Hot Weather", "warm": "Mild Weather",
        "cool": "Cool Weather", "cold": "Cold Weather",
    }
    temp_label = temp_labels.get(temp, "Mild Weather")

    return f"{match} ({setting_label} / {temp_label})"


# ── Card builder ──────────────────────────────────────────────────────────────

def _build_outfit_card(
    items:           List[Dict],
    occasion:        Dict,
    score_breakdown: Dict,
    used_titles:     Optional[Set[str]] = None,
) -> Dict:
    """
    Build a structured at-a-glance outfit card from scorer outputs.

    Every attribute is derived from real per-outfit data so each card
    is unique even within the same event. No LLM call except for the
    short stylist verdict.

    Args:
        items:           All items in the outfit (core + finishing pieces).
        occasion:        Structured occasion dict from parse_occasion().
        score_breakdown: V2 score breakdown dict from score_outfit_v2().

    Returns:
        Dict matching the OutfitCard schema.
    """
    tags    = score_breakdown.get("tags", {})
    compat  = score_breakdown.get("compatibility", 0.5)
    # event_appropriate replaces appropriateness as the primary occasion-fit signal
    approp  = score_breakdown.get("event_appropriate",
              score_breakdown.get("appropriateness", 0.5))
    novelty = score_breakdown.get("novelty", 0.5)
    risk_label = tags.get("risk", "no significant risk")
    # event_fit_pct: rounded % of the multi-dim event alignment score (for UI badge)
    event_fit_pct = round(approp * 100)

    raw_color_label  = tags.get("color_story", "mixed palette")
    silhouette_tag   = tags.get("silhouette",  "")

    occ_type    = occasion.get("occasion_type",       "casual")
    formality   = occasion.get("formality_level",      0.5)
    temp        = occasion.get("temperature_context",  "warm")
    setting     = occasion.get("setting",              "indoor")
    event_tokens = occasion.get("event_tokens",        [])

    # ── 🔥 Trend-o-meter ──────────────────────────────────────────────────────
    trend_stars, trend_label = _trend_stars_and_label(novelty, compat, approp, items)

    # ── 💃 Vibe Check ─────────────────────────────────────────────────────────
    vibe = _vibe_check(occ_type, formality, event_tokens, raw_color_label, compat, items)

    # ── 🎨 Color Theory ───────────────────────────────────────────────────────
    color_theory = _color_theory_label(raw_color_label, items)

    # ── 👗 Fit Check ──────────────────────────────────────────────────────────
    fit_check = _fit_check_label(compat, silhouette_tag, items)

    # ── Seasonal trend adjustment (±1 star) ───────────────────────────────────
    # Uses already-computed vibe/color_theory/fit_check + item colors.
    # _trend_stars_and_label() is untouched; this is a post-pass adjustment only.
    try:
        from services.trend_service import score_trend
        season_score = score_trend(
            _item_colors(items),
            {"vibe": vibe, "color_theory": color_theory, "fit_check": fit_check},
        )
        if season_score >= 0.75:
            trend_stars = min(5, trend_stars + 1)
        elif season_score <= 0.35:
            trend_stars = max(1, trend_stars - 1)
    except Exception:
        pass

    # ── 🌡️ Weather Sync ──────────────────────────────────────────────────────
    weather_sync = _weather_sync_label(approp, temp, setting, items)
    look_title = _look_title(items, occasion, fit_check, color_theory, used_titles=used_titles)

    # ── Risk flag ─────────────────────────────────────────────────────────────
    risk_flag = None
    if risk_label and risk_label != "no significant risk":
        risk_flag = risk_label

    return {
        "trend_stars":    trend_stars,
        "trend_label":    trend_label,
        "look_title":     look_title,
        "vibe":           vibe,
        "color_theory":   color_theory,
        "fit_check":      fit_check,
        "weather_sync":   weather_sync,
        "risk_flag":      risk_flag,
        "event_fit_pct":  event_fit_pct,   # multi-dim event alignment % (replaces match %)
        "verdict":        "",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Composite outfit scorer
# ─────────────────────────────────────────────────────────────────────────────

def score_outfit(
    outfit_items: List[Dict],
    occasion: Dict,
    user_feedback_weight: float = 0.5,
    user_body_type: Optional[str] = None,
) -> float:
    """
    Compute the composite hybrid score for an outfit.

    Args:
        outfit_items:         List of item dicts.
        occasion:             Structured occasion dict.
        user_feedback_weight: Pre-computed feedback signal (0–1); defaults to neutral 0.5.
        user_body_type:       Optional body type string (e.g. "hourglass", "pear").

    Returns:
        Float score in [0, 1].
    """
    event_formality = occasion.get("formality_level", 0.5)
    temperature     = occasion.get("temperature_context", "")

    # ── Color harmony ─────────────────────────────────────────────────────
    color_pairs = list(itertools.combinations(
        [item.get("color", "black") for item in outfit_items], 2
    ))
    color_score = (
        sum(score_color_compatibility(a, b) for a, b in color_pairs) / len(color_pairs)
        if color_pairs else 1.0
    )

    # ── Formality alignment ───────────────────────────────────────────────
    formality_score = sum(
        score_formality_alignment(item.get("formality_score", 0.5), event_formality)
        for item in outfit_items
    ) / len(outfit_items)

    # ── Season compatibility ──────────────────────────────────────────────
    season_score = sum(
        score_season_compatibility(item.get("season", "all"), temperature)
        for item in outfit_items
    ) / len(outfit_items)

    # ── Embedding similarity ──────────────────────────────────────────────
    embedding_score = compute_outfit_embedding_score(outfit_items)

    # ── Preference (feedback + body type) ────────────────────────────────
    body_score = score_body_type_fit(outfit_items, user_body_type)
    preference_score = 0.5 * user_feedback_weight + 0.5 * body_score

    # ── Style coherence ───────────────────────────────────────────────────
    coherence_score = score_style_coherence(outfit_items)

    # ── Composite ─────────────────────────────────────────────────────────
    final = (
        WEIGHTS["color"]      * color_score
        + WEIGHTS["formality"]  * formality_score
        + WEIGHTS["season"]     * season_score
        + WEIGHTS["embedding"]  * embedding_score
        + WEIGHTS["preference"] * preference_score
        + WEIGHTS["coherence"]  * coherence_score
    )

    final = round(final, 4)
    _debug_print_score(
        "v1_finishing",
        outfit_items,
        color=color_score,
        formality=formality_score,
        season=season_score,
        embedding=embedding_score,
        preference=preference_score,
        coherence=coherence_score,
        final=final,
    )

    return final


# ─────────────────────────────────────────────────────────────────────────────
# Item filtering
# ─────────────────────────────────────────────────────────────────────────────

def _is_beach_outerwear(item: Dict) -> bool:
    """
    Return True only when an outerwear piece is suitable for a beach/pool/resort
    occasion.  Items with no descriptor data are allowed through (benefit of the
    doubt) so we don't silently drop valid cover-ups that weren't fully analysed.

    Allowed fabrics  : cotton, linen, silk, chiffon, spandex + lightweight relatives
    Allowed styles   : wide/flowing sleeves, open backs, fringe/tassels, drawstrings
    Allowed construct: sheer or semi-sheer, cutouts
    Blocked          : heavy fabrics, insulated/padded types, coats/puffers/trenches
    """
    desc          = item.get("descriptors") or {}
    fabric        = (desc.get("fabric_type") or desc.get("fabric") or "").lower().strip()
    outer_type    = (desc.get("outerwear_type") or "").lower().strip()
    sleeve_style  = (desc.get("sleeve_style")  or "").lower().strip()
    back_style    = (desc.get("back_style")    or "").lower().strip()
    detailing     = (desc.get("detailing")     or "").lower().strip()
    sheer         = (desc.get("sheer")         or "").lower().strip()
    warmth        = (desc.get("warmth")        or "").lower().strip()
    insulation    = (desc.get("insulation")    or "").lower().strip()
    closure       = (desc.get("closure")       or "").lower().strip()

    # ── Hard disqualifiers ────────────────────────────────────────────────────
    _HEAVY_FABRICS = {
        "wool", "leather", "suede", "faux fur", "tweed", "fleece",
        "denim", "velvet", "corduroy", "shearling",
    }
    if fabric in _HEAVY_FABRICS:
        return False
    if warmth in {"warm", "thermal"}:
        return False
    if insulation in {"heavyweight", "insulated", "down-filled", "midweight"}:
        return False
    # Structured/padded outerwear types are wrong for beach regardless of fabric
    _HEAVY_OUTER_TYPES = {"puffer", "bomber", "coat", "trench", "shacket", "blazer"}
    if any(t in outer_type for t in _HEAVY_OUTER_TYPES):
        return False

    # ── Positive qualifiers (any one is sufficient) ───────────────────────────
    # Fabric — user-specified list + lightweight functional relatives
    _BEACH_FABRICS = {
        "cotton", "linen", "silk", "chiffon", "spandex",
        "rayon", "mesh", "satin", "lycra", "elastane",
        "nylon", "bamboo", "modal",
    }
    if fabric in _BEACH_FABRICS:
        return True

    # Sheer / semi-sheer construction (lightweight by definition)
    if sheer in {"sheer", "semi-sheer"}:
        return True

    # Wide or flowing sleeve styles
    _WIDE_SLEEVES = {"puff", "bishop", "balloon", "bell", "batwing", "flutter", "wide"}
    if any(s in sleeve_style for s in _WIDE_SLEEVES):
        return True

    # Open or low back
    if any(b in back_style for b in {"open back", "low back", "keyhole"}):
        return True

    # Beach-indicative detailing: fringe/tassels, cutouts
    if any(d in detailing for d in {"fringe", "cut-out", "tassel", "crochet", "lace-up"}):
        return True

    # Closure styles typical of beach coverups
    if any(c in closure for c in {"drawstring", "tie", "open front", "wrap"}):
        return True

    # Outerwear types that are inherently beach-adjacent
    _BEACH_OUTER_TYPES = {"coverup", "cover-up", "cape", "shrug", "kimono", "sarong", "vest", "cardigan"}
    if any(t in outer_type for t in _BEACH_OUTER_TYPES):
        return True

    # No descriptor data at all → allow through (unanalysed item, don't block)
    if not fabric and not outer_type and not sheer:
        return True

    return False


def filter_candidates(items: List[Dict], occasion: Dict) -> Dict[str, List[Dict]]:
    """
    Partition items into role buckets, filtering out items whose formality
    is more than 2× the tolerance band away from the event formality.

    Weather hard gates (applied after formality gate):
    ──────────────────────────────────────────────────
    Hot / warm weather
      → Heavy insulating outerwear (coat, puffer, trench, parka, shearling…)
        is excluded from the outerwear bucket.  Light layers (blazer, cardigan,
        denim jacket, bomber, vest, cape) remain.  Outerwear is optional in combo
        assembly so an empty outerwear bucket never reduces displayable outfits.

    Rainy weather
      → Clearly impractical shoes (flat open sandals, slides, flip-flops and
        suede/nubuck fabric shoes) are removed from the shoes bucket.
        Safety valve: if every shoe in the wardrobe would be excluded the gate
        is lifted entirely so the user still gets outfit suggestions (scoring
        already penalises the impractical shoes heavily in that edge case).
    """
    event_formality = occasion.get("formality_level", 0.5)

    # ── Weather signal parsing ─────────────────────────────────────────────────
    _temp_ctx    = (occasion.get("temperature_context") or "").lower()
    _rtj         = occasion.get("raw_text_json") or {}
    _raw_weather = str(_rtj.get("weather") or "").lower() if _rtj else ""
    _weather_txt = f"{_temp_ctx} {_raw_weather}".strip()

    _is_hot   = any(w in _weather_txt for w in ("hot", "warm", "humid", "heat"))
    _is_rainy = any(w in _weather_txt for w in ("rain", "rainy", "drizzle", "wet", "storm"))

    # Heavy insulating outerwear that is impractical / uncomfortable at hot events.
    # Light layers (blazer, cardigan, denim jacket, bomber, vest, cape, shrug) are
    # intentionally absent — they remain valid candidates at warm temperatures.
    _HOT_OUTER_EXCLUDE: Set[str] = {
        "coat", "wool coat", "overcoat", "puffer", "parka",
        "trench", "shearling", "anorak", "fur coat", "faux fur coat",
    }

    buckets: Dict[str, List[Dict]] = {
        "tops":        [],
        "bottoms":     [],
        "dresses":     [],
        "jumpsuits":   [],
        "shoes":       [],
        "outerwear":   [],
        "accessories": [],
        "jewelry":     [],
        "set":         [],
        "swimwear":    [],
        "loungewear":  [],
    }

    event_tokens   = set(occasion.get("event_tokens") or [])
    _BEACH_TOKENS  = {"beach", "pool", "swim", "resort"}
    is_beach_event = bool(_BEACH_TOKENS & event_tokens)

    for item in items:
        category = _normalize_category_name(item.get("category"))
        formality_diff = abs(item.get("formality_score", 0.5) - event_formality)

        # Swimwear always qualifies at beach/pool — its near-zero formality score
        # should never gate-keep it when the occasion explicitly calls for it.
        # _is_swimwear_piece() checks category, descriptors, AND item_type so a
        # miscategorised swimsuit (stored as "tops" etc.) is still correctly routed.
        if _is_swimwear_piece(item):
            if is_beach_event:
                buckets["swimwear"].append(item)
            # else: silently dropped — swimwear never appears at non-beach events
            continue

        # Outerwear at beach is restricted to beach-appropriate pieces only
        # (cotton/linen/silk/chiffon/spandex, sheer, wide-sleeve, open-back,
        # fringe/tassel/cutout, drawstring, coverup/cape/kimono/shrug types).
        # Coats, puffers, blazers, trenches, and heavy fabrics are excluded.
        if is_beach_event and category == "outerwear":
            if _is_beach_outerwear(item):
                buckets["outerwear"].append(item)
            continue  # skip formality gate regardless — beach rules apply

        if formality_diff > FORMALITY_TOLERANCE * 2:
            continue  # too casual/formal for this event

        # ── Hot-weather outerwear gate ─────────────────────────────────────────
        # Exclude heavy insulating outerwear at warm/hot events.
        # Applied AFTER the formality gate so only formality-eligible pieces are
        # considered. Outerwear is optional in combo assembly — an empty bucket
        # simply means outfits will be assembled without a layer.
        if _is_hot and category == "outerwear":
            _desc      = item.get("descriptors") or {}
            _outer_type = (
                _desc.get("outer_type") or _desc.get("outerwear_type") or
                item.get("item_type") or ""
            ).lower()
            if any(h in _outer_type for h in _HOT_OUTER_EXCLUDE):
                continue  # heavy insulating layer at a hot event — skip

        if category in buckets:
            buckets[category].append(item)

    # ── Rainy-weather shoe gate (post-loop, with safety valve) ────────────────
    # Flat open footwear and suede/nubuck shoes are impractical in rain.
    # The gate is only applied when at least one weather-appropriate shoe survives;
    # if the entire wardrobe is open-toe/suede the gate is lifted so combo
    # assembly can still run (scoring already penalises these choices heavily).
    if _is_rainy and buckets["shoes"]:
        def _rain_shoe_fails(shoe: Dict) -> bool:
            _desc      = shoe.get("descriptors") or {}
            _shoe_type = (
                _desc.get("shoe_type") or _desc.get("heel_type") or
                shoe.get("item_type") or ""
            ).lower()
            _fabric    = (_desc.get("fabric_type") or _desc.get("fabric") or "").lower()
            _heel_h    = (_desc.get("heel_height") or "").lower()

            # Flat open-toe footwear: sandal/slide/flip only when NOT heeled
            # (a heeled strappy sandal with ankle strap is borderline acceptable)
            _is_open_flat = (
                any(t in _shoe_type for t in ("flip", "slide"))
                or (any(t in _shoe_type for t in ("sandal",)) and _heel_h in {"", "flat", "low"})
            )
            # Delicate / porous fabrics that are damaged by water
            _is_rain_fabric = any(f in _fabric for f in ("suede", "nubuck", "velvet", "satin"))

            return _is_open_flat or _is_rain_fabric

        _rain_ok = [s for s in buckets["shoes"] if not _rain_shoe_fails(s)]
        if _rain_ok:
            buckets["shoes"] = _rain_ok
        # else: safety valve — keep all shoes so outfits can still be assembled

    return buckets


# ─────────────────────────────────────────────────────────────────────────────
# Accessory attachment
# ─────────────────────────────────────────────────────────────────────────────

def attach_accessories(
    core_outfit: List[Dict],
    accessories: List[Dict],
    occasion: Dict,
    user_body_type: Optional[str] = None,
    max_accessories: int = 2,
    forced_accessories: Optional[List[Dict]] = None,
    exclude_ids: Optional[set] = None,
) -> List[Dict]:
    """
    Rule-based finishing-piece selection.
    Max 2 accessories/jewelry pieces, no two of the same subtype (e.g. two bags).

    Args:
        exclude_ids: Set of accessory IDs already used in previously-generated
                     outfits.  Excluded candidates are moved to a fallback pool
                     so they can still be selected when no fresh option exists.
    """
    forced_accessories = forced_accessories or []
    if not accessories and not forced_accessories:
        return []

    event_tokens = _occasion_token_set(occasion)
    is_minimal_direction = bool(_MINIMAL_STYLE_TOKENS & event_tokens)
    if is_minimal_direction:
        max_accessories = min(max_accessories, 1)

    forced_ids  = {str(acc.get("id")) for acc in forced_accessories if acc.get("id")}
    exclude_ids = exclude_ids or set()

    def _is_statement_finishing_piece(item: Dict) -> bool:
        desc = item.get("descriptors") or {}
        style = " ".join(
            str(desc.get(key) or "")
            for key in ("style", "jewelry_type", "accessory_type", "finish")
        ).lower()
        color = (item.get("color") or "").lower()
        pattern = (item.get("pattern") or "").lower()
        return (
            pattern not in {"", "solid", "plain", "none"}
            or color not in _NEUTRAL_COLORS
            or any(token in style for token in ("statement", "embellished", "bold", "sculptural", "logo"))
        )

    selected: List[Dict] = []
    used_subtypes: Dict[str, int] = {}

    for acc in forced_accessories:
        if len(selected) >= max_accessories:
            break
        subtype = acc.get("accessory_subtype", "other")
        if used_subtypes.get(subtype, 0) >= 1:
            continue
        selected.append(acc)
        used_subtypes[subtype] = used_subtypes.get(subtype, 0) + 1

    # ── Event-aware accessory scoring ─────────────────────────────────────────
    # Blend V1 outfit score (color harmony + formality + embedding) with a
    # 30% bonus from event_appropriate so accessories align with event mood/time.
    # A minimum event_appropriate floor of 0.38 acts as a soft veto — severely
    # misaligned accessories (wrong formality or mood) are moved to fallback.
    from services.event_appropriate import score_event_appropriate as _ea_score

    def _score_accessory(acc: Dict) -> float:
        v1 = score_outfit(core_outfit + [acc], occasion, user_body_type=user_body_type)
        statement_penalty = 0.18 if is_minimal_direction and _is_statement_finishing_piece(acc) else 0.0
        ea, _, _ = _ea_score([acc], occasion)
        # ea applied as a 30% bonus; floor veto handled by caller splitting fresh/fallback
        return round(v1 * 0.70 + ea * 0.30 - statement_penalty, 4)

    # Partition candidates into fresh (not used in prior outfits) and fallback
    fresh_candidates:    List[Dict] = []
    fallback_candidates: List[Dict] = []
    for acc in accessories:
        acc_id = str(acc.get("id"))
        if acc_id in forced_ids:
            continue
        ea, _, _ = _ea_score([acc], occasion)
        # Hard event-alignment floor: accessories below 0.38 are only used as
        # absolute last resort (no other option exists for that subtype)
        if ea < 0.38:
            fallback_candidates.append(acc)
        elif acc_id in exclude_ids:
            fallback_candidates.append(acc)   # prefer fresh accessories per outfit
        else:
            fresh_candidates.append(acc)

    scored_fresh    = sorted(
        [(_score_accessory(a), a) for a in fresh_candidates],
        key=lambda x: x[0], reverse=True,
    )
    scored_fallback = sorted(
        [(_score_accessory(a), a) for a in fallback_candidates],
        key=lambda x: x[0], reverse=True,
    )
    scored = scored_fresh + scored_fallback

    for _, acc in scored:
        if len(selected) >= max_accessories:
            break
        subtype = acc.get("accessory_subtype", "other")
        if used_subtypes.get(subtype, 0) >= 1:
            continue
        selected.append(acc)
        used_subtypes[subtype] = used_subtypes.get(subtype, 0) + 1

    return selected


# ─────────────────────────────────────────────────────────────────────────────
# Main recommendation function
# ─────────────────────────────────────────────────────────────────────────────

def _combo_key(items: List[Dict]) -> str:
    """Stable, order-independent key for a set of outfit items."""
    return "|".join(sorted(str(item.get("id", "")) for item in items))


def wardrobe_coverage_gaps(user_items: List[Dict]) -> List[str]:
    """
    Return a list of plain-English hints for item types that are absent
    from the wardrobe but helpful for the supported outfit families.
    """
    categories  = {_normalize_category_name(i.get("item_type")) for i in user_items}
    categories |= {_normalize_category_name(i.get("category")) for i in user_items}

    has_tops      = bool({"tops", "top"} & categories)
    has_bottoms   = bool({"bottoms", "bottom", "skirts", "trousers"} & categories)
    has_shoes     = bool({"shoes", "footwear"} & categories)
    has_one_piece = bool({"dresses", "dress", "jumpsuits", "jumpsuit", "rompers", "romper", "playsuit"} & categories)
    has_outerwear = bool({"outerwear", "jackets", "jacket", "coat"} & categories)
    has_set       = bool({"set"} & categories)
    has_swimwear  = bool({"swimwear"} & categories)

    gaps: List[str] = []

    can_do_ab = has_tops and has_bottoms and has_shoes
    can_do_cd = has_one_piece and has_shoes
    can_do_ef = has_set and has_shoes
    can_do_g  = has_swimwear

    if not can_do_ab and not can_do_cd and not can_do_ef and not can_do_g:
        # No outfit family possible — give targeted hints
        if not has_shoes and not has_swimwear:
            gaps.append("Add at least one pair of shoes to complete separates, one-piece, or set looks")
        if not has_tops and not has_one_piece and not has_set:
            gaps.append("Add a top, dress, jumpsuit, or co-ord set to start building outfits")
        elif not has_tops:
            gaps.append("Add at least one top to build a separates look")
        if not has_bottoms and not has_one_piece and not has_set:
            gaps.append("Add a bottom (trousers or skirt), dress, jumpsuit, or co-ord set to complete a look")
        elif not has_bottoms:
            gaps.append("Add at least one bottom (trousers or skirt) to complete a separates look")
    else:
        # At least one outfit family works — give aspirational nudges
        if can_do_ab and not can_do_cd:
            gaps.append("Add a dress or jumpsuit plus shoes to open up one-piece looks")
        if not has_outerwear and (can_do_ab or can_do_cd or can_do_ef or can_do_g):
            gaps.append("Add a jacket or coat to unlock optional layered variants")
        if not can_do_ef and not has_set:
            gaps.append("Add a co-ord set to unlock coordinated set outfits")

    return gaps


def _outfit_feedback_weight(items: List[Dict], combo_weights: Dict[str, float]) -> float:
    """
    Look up this exact combo in the occasion-scoped feedback map.
    Defaults to neutral 0.5 when the combo has never been rated.
    """
    return combo_weights.get(_combo_key(items), 0.5)


def generate_outfit_suggestions(
    user_items: List[Dict],
    occasion: Dict,
    event_id: str,
    user_id: str,
    top_n: int = 3,
    user_profile: Optional[Dict] = None,
    combo_feedback_weights: Optional[Dict[str, float]] = None,
    seen_item_combos: Optional[List[List[str]]] = None,
    outfit_history_embeddings: Optional[List[List[float]]] = None,
    attribute_prefs: Optional[Dict[str, Dict[str, float]]] = None,
    user_style_centroid: Optional[List[float]] = None,
    anchor_item_id: Optional[str] = None,
) -> Tuple[List[Dict], bool]:
    """
    Main entry point for outfit generation. Uses V2 outfit-level scoring.

    Args:
        user_items:                  All clothing items belonging to the user (from DB).
        occasion:                    Structured occasion dict (from LLM parsing).
        event_id:                    UUID of the event row.
        user_id:                     UUID of the requesting user.
        top_n:                       Number of outfit suggestions to return.
        user_profile:                Optional user profile dict (body_type priors).
        combo_feedback_weights:      Occasion-scoped combo reputation map.
                                     Keys are _combo_key strings; values are 0-1 weights.
                                     Combos absent from the map default to neutral 0.5.
        seen_item_combos:            Item-ID sets shown in previous batches (accumulated).
                                     These combos are hard-excluded so the same look
                                     does not reappear on refresh.
        outfit_history_embeddings:   Optional pre-computed past outfit embeddings for
                                     novelty scoring (v2). If None, computed from
                                     seen_item_combos automatically.

    Returns:
        (suggestions, all_seen) — suggestions ready for DB insertion;
        all_seen=True when every returned outfit was already shown before
        (wardrobe variety exhausted for this occasion).
    """
    user_body_type: Optional[str] = (user_profile or {}).get("body_type")
    combo_weights: Dict[str, float] = combo_feedback_weights or {}

    # Seen sets for soft downranking (frozensets of item ID strings)
    seen_sets: set = {
        frozenset(combo) for combo in (seen_item_combos or []) if combo
    }

    # Build past outfit embeddings for novelty scoring
    # Each seen combo is a list of item-ID strings; we reconstruct embeddings from loaded items
    _item_by_id: Dict[str, Dict] = {str(item.get("id")): item for item in user_items}
    anchor_item = _item_by_id.get(str(anchor_item_id)) if anchor_item_id else None
    outfit_history_embeddings_computed: List[List[float]] = []
    for id_set in (seen_item_combos or []):
        past_items = [_item_by_id[iid] for iid in id_set if iid in _item_by_id]
        vecs = [i.get("embedding_vector") for i in past_items if i.get("embedding_vector")]
        if vecs:
            dim = len(vecs[0])
            mean_emb = [sum(v[d] for v in vecs) / len(vecs) for d in range(dim)]
            outfit_history_embeddings_computed.append(mean_emb)
    # Use caller-provided embeddings if given, else use computed ones from seen combos
    _history = outfit_history_embeddings or outfit_history_embeddings_computed

    buckets      = filter_candidates(user_items, occasion)
    accessories  = buckets.pop("accessories", []) + buckets.pop("jewelry", [])

    if anchor_item:
        anchor_category = _normalize_category_name(anchor_item.get("category"))
        if anchor_category in buckets and not _is_finishing_category(anchor_category):
            buckets[anchor_category] = [anchor_item]

    tops_list      = buckets.get("tops",      [])
    bottoms_list   = buckets.get("bottoms",   [])
    shoes_list     = buckets.get("shoes",     [])
    dresses_list   = buckets.get("dresses",   [])
    jumpsuits_list = buckets.get("jumpsuits", [])
    one_piece_list = dresses_list + jumpsuits_list
    outer_list     = buckets.get("outerwear", [])
    sets_list      = buckets.get("set",       [])
    swimwear_list  = buckets.get("swimwear",  [])

    # ── Build candidate cores across the four supported outfit families ───
    # 1. top + bottom + shoes (+ optional outerwear)
    # 2. dress/jumpsuit + shoes (+ optional outerwear)
    # 3. set + shoes (+ optional outerwear)
    # 4. swimwear (+ optional outerwear)
    template_combos: Dict[str, List[List[Dict]]] = {
        "top_bottom_shoes": [],
        "dress_or_jumpsuit_shoes": [],
        "set_shoes": [],
        "swimwear": [],
    }

    for top in tops_list:
        for bottom in bottoms_list:
            for shoe in shoes_list:
                template_combos["top_bottom_shoes"].append([top, bottom, shoe])
                for outer in outer_list:
                    template_combos["top_bottom_shoes"].append([top, bottom, shoe, outer])

    for dress in one_piece_list:
        for shoe in shoes_list:
            template_combos["dress_or_jumpsuit_shoes"].append([dress, shoe])
            for outer in outer_list:
                template_combos["dress_or_jumpsuit_shoes"].append([dress, shoe, outer])

    for s in sets_list:
        for shoe in shoes_list:
            template_combos["set_shoes"].append([s, shoe])
            for outer in outer_list:
                template_combos["set_shoes"].append([s, shoe, outer])

    for sw in swimwear_list:
        template_combos["swimwear"].append([sw])
        for outer in outer_list:
            template_combos["swimwear"].append([sw, outer])

    # ── Score combos, splitting fresh vs already-seen looks ──────────────
    fresh_best_per_template: List[Tuple[float, List[Dict], Dict]] = []
    fresh_overflow:          List[Tuple[float, List[Dict], Dict]] = []
    seen_best_per_template:  List[Tuple[float, List[Dict], Dict]] = []
    seen_overflow:           List[Tuple[float, List[Dict], Dict]] = []
    fresh_available = False
    forced_accessories = [anchor_item] if anchor_item and _is_finishing_category(anchor_item.get("category")) else []

    for _tname, combos in template_combos.items():
        if not combos:
            continue

        fresh_scored_combos: List[Tuple[float, List[Dict], Dict]] = []
        seen_scored_combos: List[Tuple[float, List[Dict], Dict]] = []
        for c in combos:
            if anchor_item and not _is_finishing_category(anchor_item.get("category")):
                anchor_id = str(anchor_item.get("id"))
                if all(str(item.get("id")) != anchor_id for item in c):
                    continue
            is_seen = frozenset(str(item["id"]) for item in c) in seen_sets
            fw = _outfit_feedback_weight(c, combo_weights)
            score, breakdown = score_outfit_v2(
                c, occasion,
                user_feedback_weight=fw,
                user_body_type=user_body_type,
                outfit_history_embeddings=_history,
                attribute_prefs=attribute_prefs,
                user_style_centroid=user_style_centroid,
                user_profile=user_profile,
            )
            _debug_print_score(
                "candidate_core",
                c,
                template=_tname,
                is_seen=is_seen,
                feedback_weight=fw,
                score=score,
                composite=breakdown.get("composite", score),
            )
            entry = (score, c, breakdown)
            if is_seen:
                seen_scored_combos.append(entry)
            else:
                fresh_available = True
                fresh_scored_combos.append(entry)

        fresh_scored_combos.sort(key=lambda x: x[0], reverse=True)
        seen_scored_combos.sort(key=lambda x: x[0], reverse=True)
        if fresh_scored_combos:
            _best_score, _best_items, _best_breakdown = fresh_scored_combos[0]
            _debug_print_score(
                "template_best",
                _best_items,
                template=_tname,
                freshness="fresh",
                composite=_best_breakdown.get("composite", _best_score),
                event_appropriate=_best_breakdown.get("event_appropriate", 0.0),
                preference=_best_breakdown.get("preference", 0.0),
                flattery=_best_breakdown.get("flattery", 0.0),
                polish=_best_breakdown.get("polish", 0.0),
                risk_penalty=_best_breakdown.get("risk_penalty", 0.0),
            )
            fresh_best_per_template.append(fresh_scored_combos[0])
            fresh_overflow.extend(fresh_scored_combos[1:])
        elif seen_scored_combos:
            _best_score, _best_items, _best_breakdown = seen_scored_combos[0]
            _debug_print_score(
                "template_best",
                _best_items,
                template=_tname,
                freshness="seen",
                composite=_best_breakdown.get("composite", _best_score),
                event_appropriate=_best_breakdown.get("event_appropriate", 0.0),
                preference=_best_breakdown.get("preference", 0.0),
                flattery=_best_breakdown.get("flattery", 0.0),
                polish=_best_breakdown.get("polish", 0.0),
                risk_penalty=_best_breakdown.get("risk_penalty", 0.0),
            )
            seen_best_per_template.append(seen_scored_combos[0])
            seen_overflow.extend(seen_scored_combos[1:])

    if not fresh_available:
        logger.warning("Not enough fresh items to form a complete outfit.")
        return [], True

    selected_pool = fresh_best_per_template
    selected_overflow = fresh_overflow

    selected_pool.sort(key=lambda x: x[0], reverse=True)
    top_cores = list(selected_pool[:top_n])

    if len(top_cores) < top_n and selected_overflow:
        selected_overflow.sort(key=lambda x: x[0], reverse=True)
        for entry in selected_overflow:
            if len(top_cores) >= top_n:
                break
            top_cores.append(entry)

    # ── Structural deduplication ─────────────────────────────────────────────────
    # Business rule: two outfits are the SAME look if they share identical
    # garments + outerwear + shoes, regardless of accessory differences.
    #
    # "Structural" items = the pieces that define the silhouette and color story:
    #   garments  → tops, bottoms, dresses, jumpsuits, set, swimwear
    #   outerwear → outerwear
    #   footwear  → shoes
    #
    # Accessories (jewelry, bags) are finishing touches — they are attached AFTER
    # core selection and must NOT produce what feels like a duplicate suggestion.
    #
    # After dedup, if we're below top_n, fill from the scored overflow pool.
    _STRUCTURAL_CATS = {
        "tops", "bottoms", "dresses", "jumpsuits", "set", "swimwear",
        "outerwear", "shoes",
    }

    def _structural_fp(items: List[Dict]) -> frozenset:
        return frozenset(
            str(i.get("id"))
            for i in items
            if _normalize_category_name(i.get("category")) in _STRUCTURAL_CATS
        )

    _seen_structural_fps: set = set()
    _deduped_cores: List = []
    for _entry in top_cores:
        _fp = _structural_fp(_entry[1])
        if _fp not in _seen_structural_fps:
            _seen_structural_fps.add(_fp)
            _deduped_cores.append(_entry)

    # Refill from overflow when dedup removed duplicates
    if len(_deduped_cores) < top_n:
        _all_overflow_pool = sorted(
            fresh_overflow + seen_overflow,
            key=lambda e: e[0], reverse=True,
        )
        for _entry in _all_overflow_pool:
            if len(_deduped_cores) >= top_n:
                break
            _fp = _structural_fp(_entry[1])
            if _fp not in _seen_structural_fps:
                _seen_structural_fps.add(_fp)
                _deduped_cores.append(_entry)

    top_cores = _deduped_cores

    # ── Outerwear cross-look diversity ───────────────────────────────────────────
    # When every selected outfit includes the SAME single outerwear piece,
    # the moodboard looks uniform (same jacket 3× = same color story, same title).
    # If the full pool contains lower-scoring alternatives without that outerwear,
    # swap the lowest-ranked outfit with the best no-outerwear variant so at
    # least one look shows the garments without the jacket.
    #
    # Guard: only apply when there is exactly 1 unique outerwear item across all
    # top outfits (i.e. it IS a single-jacket wardrobe situation, not a mismatch).
    # Never applied to swimwear looks.
    if len(top_cores) >= 2:
        _outer_ids_in_top = set()
        for _, _tc_items, _ in top_cores:
            for _tc_item in _tc_items:
                if _normalize_category_name(_tc_item.get("category")) == "outerwear":
                    _outer_ids_in_top.add(str(_tc_item.get("id")))

        # Only apply the diversity swap when EVERY outfit has outerwear AND they all
        # share the exact same single jacket.  If any outfit already has no outerwear
        # the set size is still 1 but the "problem" is already solved — skip to avoid
        # replacing a structurally-unique no-jacket look with another that may be
        # identical to an existing top outfit.
        _all_have_outer = all(
            any(_normalize_category_name(i.get("category")) == "outerwear" for i in _tc_items)
            for _, _tc_items, _ in top_cores
        )
        if len(_outer_ids_in_top) == 1 and _all_have_outer:
            _repeated_outer_id = next(iter(_outer_ids_in_top))
            # Find best scored combo that does NOT include the repeated outerwear
            _alt_pool = sorted(
                fresh_best_per_template + fresh_overflow,
                key=lambda e: e[0], reverse=True,
            )
            _no_outer_alt = next(
                (entry for entry in _alt_pool
                 if not any(str(i.get("id")) == _repeated_outer_id
                            for i in entry[1])),
                None,
            )
            if _no_outer_alt is not None:
                # Replace the lowest-scoring top outfit with the no-outerwear alternative
                # (keeps the best 2 looks intact)
                top_cores[-1] = _no_outer_alt

    # ── Beach/pool swimwear prioritisation ────────────────────────────────────────
    # At beach occasions the appropriateness cap (1.0) makes swimwear tie with
    # other casual outfits, so pure score-ranking alone does not guarantee
    # swimwear fills every available slot.  When the wardrobe contains swimwear:
    #   1. Collect ALL scored swimwear combos (from best-per-template + overflow).
    #   2. Collect ALL non-swimwear combos likewise.
    #   3. Rebuild top_cores by filling swimwear slots first (up to top_n),
    #      then padding with the best non-swimwear combos.
    # This means two swimsuits → two swimwear looks; one swimsuit → one swimwear
    # look + best remaining alternatives; no swimsuit → unchanged ranking.
    _BEACH_OCC_TOKENS = {"beach", "pool", "swim", "resort"}
    _has_beach_occ = bool(_BEACH_OCC_TOKENS & set(occasion.get("event_tokens") or []))
    if _has_beach_occ and swimwear_list:
        def _combo_has_swimwear(combo_items: List[Dict]) -> bool:
            return any(_is_swimwear_piece(i) for i in combo_items)

        _full_pool = fresh_best_per_template + fresh_overflow
        _sw_pool   = sorted(
            [e for e in _full_pool if _combo_has_swimwear(e[1])],
            key=lambda e: e[0], reverse=True,
        )
        _non_sw_pool = sorted(
            [e for e in _full_pool if not _combo_has_swimwear(e[1])],
            key=lambda e: e[0], reverse=True,
        )
        # Deduplicate by item-set so the same swimsuit doesn't fill every slot
        _seen_item_sets: set = set()
        _deduped_sw: List = []
        for entry in _sw_pool:
            _key = frozenset(str(i["id"]) for i in entry[1])
            if _key not in _seen_item_sets:
                _seen_item_sets.add(_key)
                _deduped_sw.append(entry)
        _deduped_non_sw: List = []
        for entry in _non_sw_pool:
            _key = frozenset(str(i["id"]) for i in entry[1])
            if _key not in _seen_item_sets:
                _seen_item_sets.add(_key)
                _deduped_non_sw.append(entry)

        if _deduped_sw:
            top_cores = (_deduped_sw + _deduped_non_sw)[:top_n]

    # ── Final structural dedup safety net ────────────────────────────────────
    # The outerwear-diversity and swimwear-prioritisation blocks can introduce
    # structural duplicates after the first dedup pass.  Run a second pass here
    # so no two structurally identical core outfits ever reach the user, regardless
    # of what the special-case blocks did.
    _final_seen_fps: set = set()
    _final_deduped: List = []
    for _entry in top_cores:
        _fp = _structural_fp(_entry[1])
        if _fp not in _final_seen_fps:
            _final_seen_fps.add(_fp)
            _final_deduped.append(_entry)
    top_cores = _final_deduped

    # ── Detect exhaustion: true only when no fresh combos remain ──────────
    all_seen = not fresh_available

    # ── Assemble final suggestions ────────────────────────────────────────
    # Track which accessory IDs have already been used so each outfit gets
    # fresh finishing pieces where possible (cross-outfit diversity).
    # Also track generated look_titles so each outfit in this response gets
    # a unique name — prevents "Ivory Layering × 3" when multiple outfits
    # share the same dominant colour and outerwear structure.
    _used_accessory_ids: set = set()
    _used_look_titles:   Set[str] = set()

    suggestions = []
    for outfit_score, core_items, score_breakdown in top_cores:
        selected_accessories = attach_accessories(
            core_items,
            accessories,
            occasion,
            user_body_type=user_body_type,
            forced_accessories=forced_accessories,
            exclude_ids=_used_accessory_ids,
        )
        # Register selected accessory IDs so subsequent outfits avoid repeats
        for _acc in selected_accessories:
            _used_accessory_ids.add(str(_acc.get("id")))

        all_items = core_items + selected_accessories
        card      = _build_outfit_card(all_items, occasion, score_breakdown,
                                       used_titles=_used_look_titles)
        _used_look_titles.add(card.get("look_title", ""))
        _debug_print_score(
            "selected_outfit",
            all_items,
            composite=score_breakdown.get("composite", outfit_score),
            event_appropriate=score_breakdown.get("event_appropriate", 0.0),
            preference=score_breakdown.get("preference", 0.0),
            flattery=score_breakdown.get("flattery", 0.0),
            trend=score_breakdown.get("trend", 0.0),
            polish=score_breakdown.get("polish", 0.0),
            risk_penalty=score_breakdown.get("risk_penalty", 0.0),
            accessory_count=len(selected_accessories),
            final_item_count=len(all_items),
        )

        is_seen = frozenset(str(i["id"]) for i in core_items) in seen_sets
        suggestion = {
            "id":              str(uuid4()),
            "user_id":         user_id,
            "event_id":        event_id,
            "item_ids":        [item["id"] for item in core_items],
            "accessory_ids":   [acc["id"] for acc in selected_accessories],
            "score":           outfit_score,
            "score_breakdown": score_breakdown,   # stripped before DB insert
            "explanation":     "",                # legacy field kept blank
            "card":            card,              # full structured card
            "user_rating":     None,
            "generated_at":    datetime.utcnow().isoformat(),
        }
        suggestions.append(suggestion)
    return suggestions, all_seen
