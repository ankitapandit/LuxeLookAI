"""
services/recommender.py — Core outfit recommendation engine
=============================================================
v1.9.0 — outfit-level intelligence with V2 scoring components:

  V1 scorer (used by attach_accessories):
    score = w1*color_harmony + w2*formality + w3*season
          + w4*embedding_similarity + w5*preference + w6*style_coherence

  V2 scorer (used by generate_outfit_suggestions):
    score = C*compatibility + A*appropriateness + P*preference
          + T*trend + N*novelty + D*diversity − R*risk_penalty

  V2 components:
    compatibility   — pairwise item compat (color story + silhouette + formality match)
    appropriateness — extended occasion fit (formality + season + venue + dress-code)
    preference      — personal style (feedback history + body-type priors)
    trend           — trend relevance (neutral placeholder; pipeline deferred to v2.1)
    novelty         — freshness vs recently shown outfit history
    diversity       — completeness bonus for covering expected outfit slots
    risk_penalty    — dress-code / confidence penalty (subtracted from final)

Pipeline:
  1. Filter items to valid candidates for the occasion
  2. Build core outfit combinations across 4 structural templates
  3. Score each combination using V2 outfit-level intelligence
  4. Attach up to 2 accessories per outfit using rule-based logic
  5. Generate LLM explanations for top-N outfits (seeded with V2 score breakdown tags)
  6. Return ranked suggestions
"""

from __future__ import annotations
import itertools
import logging
from typing import List, Dict, Any, Optional, Tuple
from uuid import uuid4
from datetime import datetime

from ml.embeddings import cosine_similarity
from ml.llm import explain_outfit, generate_stylist_verdict

logger = logging.getLogger(__name__)

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
WEIGHTS_V2 = {
    "compatibility":   0.28,  # C — pairwise item compat (color story + silhouette + formality match)
    "appropriateness": 0.24,  # A — occasion fit (formality + season + venue + dress-code)
    "preference":      0.22,  # P — personal style (feedback history + body-type priors)
    "trend":           0.10,  # T — trend relevance (neutral placeholder; pipeline deferred to v2.1)
    "novelty":         0.08,  # N — freshness vs recently shown outfit history
    "diversity":       0.05,  # D — completeness bonus for covering expected outfit slots
}
RISK_WEIGHT = 0.03            # R — dress-code / confidence penalty (subtracted from final)
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
        "outerwear": {"fit": ["fitted", "tailored"]},
        "set":       {"fit": ["fitted", "wrap", "tailored"],
                      "bottom_style": ["midi skirt", "mini skirt", "trousers"]},
        "swimwear":  {"swimwear_type": ["bikini", "one-piece"],
                      "coverage": ["moderate"]},
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
        "outerwear": {"fit": ["oversized", "relaxed", "belted"]},
        "set":       {"fit": ["relaxed", "oversized", "wrap"],
                      "top_style": ["crop", "off-shoulder", "bralette"]},
        "swimwear":  {"swimwear_type": ["bikini", "monokini"],
                      "top_style": ["bandeau", "triangle"]},
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
        "outerwear": {"fit": ["structured", "tailored"]},
        "set":       {"fit": ["relaxed", "a-line"],
                      "bottom_style": ["midi skirt", "wide-leg trousers"]},
        "swimwear":  {"swimwear_type": ["tankini", "one-piece", "swim dress"],
                      "coverage": ["moderate", "full"]},
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
        "outerwear": {"fit": ["open-front", "relaxed"]},
        "set":       {"fit": ["relaxed", "regular"],
                      "top_style": ["camisole", "shirt", "waistcoat"]},
        "swimwear":  {"swimwear_type": ["one-piece", "tankini", "swim dress"],
                      "coverage": ["moderate", "full"]},
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
        "outerwear": {"fit": ["relaxed", "oversized"]},
        "set":       {"fit": ["relaxed", "regular"],
                      "bottom_style": ["wide-leg trousers", "midi skirt", "skirt"]},
        "swimwear":  {"swimwear_type": ["bikini", "one-piece"],
                      "top_style": ["bandeau", "sports bra", "balconette"]},
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
        "outerwear": {"fit": ["fitted", "cropped"]},
        "set":       {"fit": ["fitted", "slim"],
                      "bottom_style": ["mini skirt", "shorts", "straight trousers"]},
        "swimwear":  {"swimwear_type": ["bikini", "monokini"],
                      "coverage": ["minimal", "moderate"]},
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
        cat = (item.get("category") or "").lower()
        fit = ((item.get("descriptors") or {}).get("fit") or "").lower()
        if fit and cat in ("tops", "bottoms", "dresses", "outerwear", "set", "loungewear"):
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
    return round(combined, 4), tags


def score_appropriateness_v2(items: List[Dict], occasion: Dict) -> Tuple[float, str]:
    """
    Extended occasion appropriateness: formality + season + venue fit + dress-code guard.
    Returns (score, reason_tag).
    """
    event_formality = occasion.get("formality_level", 0.5)
    temperature     = occasion.get("temperature_context", "")
    event_tokens    = set(occasion.get("event_tokens") or [])

    formality_score = sum(
        score_formality_alignment(item.get("formality_score", 0.5), event_formality)
        for item in items
    ) / len(items)

    season_score = sum(
        score_season_compatibility(item.get("season", "all"), temperature)
        for item in items
    ) / len(items)

    _OUTDOOR_TOKENS = {"beach", "outdoor", "rooftop", "park", "garden", "hiking", "picnic", "market"}
    _FORMAL_TOKENS  = {"wedding", "gala", "cocktail", "black-tie", "blacktie", "interview", "conference"}
    _BEACH_TOKENS   = {"beach", "pool", "swim", "resort"}

    is_outdoor      = bool(_OUTDOOR_TOKENS & event_tokens)
    is_formal_event = bool(_FORMAL_TOKENS  & event_tokens)
    is_beach        = bool(_BEACH_TOKENS   & event_tokens)

    venue_multiplier = 1.0
    for item in items:
        cat  = (item.get("category") or "").lower()
        desc = item.get("descriptors") or {}
        heel = (desc.get("heel_type") or "").lower()
        item_formality = item.get("formality_score", 0.5)
        if is_outdoor and cat == "shoes" and any(h in heel for h in ("stiletto", "block heel", "heeled")):
            venue_multiplier = min(venue_multiplier, 0.80)
        if is_formal_event and item_formality < 0.25:
            venue_multiplier = min(venue_multiplier, 0.55)
        # Swimwear is only appropriate at beach/pool — penalise anywhere else
        if cat == "swimwear" and not is_beach:
            venue_multiplier = min(venue_multiplier, 0.30)
        # Loungewear is occasion-inappropriate outside home/casual contexts
        if cat == "loungewear" and (is_formal_event or event_formality > 0.55):
            venue_multiplier = min(venue_multiplier, 0.40)

    venue_score = venue_multiplier

    if formality_score >= 0.85:
        label = "strong formality match"
    elif formality_score >= 0.65:
        label = "appropriate for occasion"
    elif formality_score >= 0.45:
        label = "slight formality mismatch"
    else:
        label = "formality mismatch risk"

    combined = 0.50 * formality_score + 0.25 * season_score + 0.25 * venue_score
    return round(combined, 4), label


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
    return round(max(0.0, min(1.0, novelty)), 4)


def score_diversity_completeness(items: List[Dict], occasion: Dict) -> Tuple[float, str]:
    """
    Completeness bonus: reward outfits that cover expected slots for the occasion formality.
    Returns (score, label).
    """
    event_formality = occasion.get("formality_level", 0.5)
    categories  = {(i.get("category") or "").lower() for i in items}
    item_types  = {(i.get("item_type")  or "").lower() for i in items}

    has_top     = "tops"      in categories
    has_bottom  = "bottoms"   in categories
    has_dress   = "dresses"   in categories
    has_set     = "set"       in categories   # co-ord set covers top + bottom slot
    has_swim    = "swimwear"  in categories
    has_shoes   = "shoes"     in categories or "footwear" in item_types
    has_outer   = "outerwear" in categories

    core_complete = (has_top and has_bottom) or has_dress or has_set or has_swim

    if core_complete and has_shoes and has_outer and event_formality >= 0.4:
        return 0.95, "complete layered look"
    if core_complete and has_shoes:
        return 0.85, "complete look"
    if core_complete and not has_shoes:
        return 0.65, "missing footwear"
    return 0.50, "incomplete outfit"


def score_risk_penalty(items: List[Dict], occasion: Dict) -> Tuple[float, str]:
    """
    Risk penalty to be SUBTRACTED from the final score.
    Returns (penalty 0–0.5, reason_tag).
    """
    event_tokens    = set(occasion.get("event_tokens") or [])
    event_formality = occasion.get("formality_level", 0.5)

    _FORMAL_EVENTS = {"wedding", "gala", "cocktail", "black-tie", "blacktie"}
    is_formal = bool(_FORMAL_EVENTS & event_tokens)

    penalty = 0.0
    reasons: List[str] = []

    _BEACH_TOKENS = {"beach", "pool", "swim", "resort"}
    is_beach = bool(_BEACH_TOKENS & event_tokens)

    for item in items:
        cat = (item.get("category") or "").lower()
        item_formality = item.get("formality_score", 0.5)
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

    penalty = min(penalty, 0.50)
    label   = "; ".join(reasons) if reasons else "no significant risk"
    return round(penalty, 4), label


def score_outfit_v2(
    outfit_items:              List[Dict],
    occasion:                  Dict,
    user_feedback_weight:      float = 0.5,
    user_body_type:            Optional[str] = None,
    outfit_history_embeddings: Optional[List[List[float]]] = None,
) -> Tuple[float, Dict]:
    """
    V2 composite scorer — outfit-level intelligence.

    Returns (composite_score, score_breakdown) where score_breakdown contains
    per-component scores and human-readable tags used to seed the LLM explanation.
    """
    # C — Compatibility
    compat_score, compat_tags = score_compatibility(outfit_items)

    # A — Appropriateness (v2 extended)
    approp_score, approp_label = score_appropriateness_v2(outfit_items, occasion)

    # P — Preference (feedback history + body-type priors)
    body_score   = score_body_type_fit(outfit_items, user_body_type)
    pref_score   = round(0.5 * user_feedback_weight + 0.5 * body_score, 4)

    # T — Trend (neutral placeholder until trend pipeline is built in v2.1)
    trend_score  = 0.50

    # N — Novelty
    novelty_score = score_novelty(outfit_items, outfit_history_embeddings or [])

    # D — Diversity/completeness
    diversity_score, diversity_label = score_diversity_completeness(outfit_items, occasion)

    # R — Risk penalty (subtracted)
    risk_penalty, risk_label = score_risk_penalty(outfit_items, occasion)

    composite = (
        WEIGHTS_V2["compatibility"]   * compat_score
        + WEIGHTS_V2["appropriateness"] * approp_score
        + WEIGHTS_V2["preference"]      * pref_score
        + WEIGHTS_V2["trend"]           * trend_score
        + WEIGHTS_V2["novelty"]         * novelty_score
        + WEIGHTS_V2["diversity"]       * diversity_score
        - RISK_WEIGHT                   * risk_penalty
    )
    composite = round(max(0.0, min(1.0, composite)), 4)

    score_breakdown = {
        "compatibility":   round(compat_score, 3),
        "appropriateness": round(approp_score, 3),
        "preference":      round(pref_score, 3),
        "trend":           round(trend_score, 3),
        "novelty":         round(novelty_score, 3),
        "diversity":       round(diversity_score, 3),
        "risk_penalty":    round(risk_penalty, 3),
        "composite":       composite,
        "tags": {
            **compat_tags,
            "occasion":     approp_label,
            "completeness": diversity_label,
            "risk":         risk_label,
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
_LIGHT_OUTERWEAR  = {"blazer", "cardigan", "denim jacket", "bomber", "vest", "cape"}
_HEAVY_OUTERWEAR  = {"coat", "puffer", "trench", "overcoat", "leather jacket", "parka"}
_NEUTRAL_COLORS   = {"black", "white", "grey", "gray", "beige", "brown", "cream", "tan", "camel", "khaki", "ivory", "nude", "charcoal", "silver"}
_TITLE_COLOR_WORDS = {
    "black": "Noir",
    "white": "Ivory",
    "beige": "Sand",
    "brown": "Mocha",
    "pink": "Rose",
    "red": "Rouge",
    "blue": "Azure",
    "navy": "Midnight",
    "green": "Sage",
    "grey": "Slate",
    "gray": "Slate",
    "yellow": "Honey",
    "orange": "Amber",
    "purple": "Plum",
    "cream": "Cream",
    "tan": "Tan",
    "gold": "Gilded",
    "silver": "Silver",
}


def _item_colors(items: List[Dict[str, Any]]) -> List[str]:
    colors: List[str] = []
    for item in items:
        raw = str(item.get("color") or "").strip().lower()
        if not raw or raw.startswith("#"):
            continue
        colors.append(raw)
    return colors


# ── Trend-o-meter ─────────────────────────────────────────────────────────────

def _trend_stars_and_label(novelty: float, compat: float, approp: float, items: List[Dict]) -> tuple:
    """
    Derive 1–5 star rating and label from scorer components.

    Weighted: novelty 40% + compat 35% + approp 25%.
    Returns (stars: int, label: str).
    """
    accessory_count = sum(1 for item in items if (item.get("category") or "").lower() == "accessories")
    structured_bonus = 0.02 if any((item.get("category") or "").lower() in {"outerwear", "dresses", "set"} for item in items) else 0.0
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
    categories = {(item.get("category") or "").lower() for item in items}
    fits = [((item.get("descriptors") or {}).get("fit") or "").lower() for item in items]
    accessory_count = sum(1 for item in items if (item.get("category") or "").lower() == "accessories")
    has_outerwear = "outerwear" in categories
    has_full_look = bool({"dresses", "set", "swimwear", "loungewear"} & categories)
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


def _look_title(items: List[Dict], occasion: Dict, fit_check: str, color_theory: str) -> str:
    colors = _item_colors(items)
    unique_colors = list(dict.fromkeys(colors))
    categories = {(item.get("category") or "").lower() for item in items}
    tokens = set(occasion.get("event_tokens") or []) | {str(occasion.get("occasion_type") or "").lower()}

    dominant = next((_TITLE_COLOR_WORDS[color] for color in unique_colors if color in _TITLE_COLOR_WORDS), None)
    if not dominant:
        if "Contrast" in color_theory:
            dominant = "Contrast"
        elif "Neutral" in color_theory:
            dominant = "Neutral"
        else:
            dominant = "Curated"

    if "outerwear" in categories and fit_check in {"Tailored", "Structured"}:
        second = "Layering"
    elif "dresses" in categories or "set" in categories:
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

    return f"{dominant} {second}"


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
) -> Dict:
    """
    Build a structured at-a-glance outfit card from scorer outputs.

    Every attribute is derived from real per-outfit data so each card
    is unique even within the same event. No LLM call except for the
    short stylist verdict.

    Args:
        items:           All items in the outfit (core + accessories).
        occasion:        Structured occasion dict from parse_occasion().
        score_breakdown: V2 score breakdown dict from score_outfit_v2().

    Returns:
        Dict matching the OutfitCard schema.
    """
    tags    = score_breakdown.get("tags", {})
    compat  = score_breakdown.get("compatibility", 0.5)
    approp  = score_breakdown.get("appropriateness", 0.5)
    novelty = score_breakdown.get("novelty", 0.5)
    risk_label = tags.get("risk", "no significant risk")

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

    # ── 🌡️ Weather Sync ──────────────────────────────────────────────────────
    weather_sync = _weather_sync_label(approp, temp, setting, items)
    look_title = _look_title(items, occasion, fit_check, color_theory)

    # ── Risk flag ─────────────────────────────────────────────────────────────
    risk_flag = None
    if risk_label and risk_label != "no significant risk":
        risk_flag = risk_label

    # ── Stylist verdict ───────────────────────────────────────────────────────
    verdict = generate_stylist_verdict(
        items, occasion, [vibe], color_theory, fit_check
    )

    return {
        "trend_stars":  trend_stars,
        "trend_label":  trend_label,
        "look_title":   look_title,
        "vibe":         vibe,
        "color_theory": color_theory,
        "fit_check":    fit_check,
        "weather_sync": weather_sync,
        "risk_flag":    risk_flag,
        "verdict":      verdict,
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

    logger.debug(
        "Outfit score — color:%.2f formality:%.2f season:%.2f "
        "embedding:%.2f preference:%.2f coherence:%.2f → %.3f",
        color_score, formality_score, season_score,
        embedding_score, preference_score, coherence_score, final,
    )
    return round(final, 4)


# ─────────────────────────────────────────────────────────────────────────────
# Item filtering
# ─────────────────────────────────────────────────────────────────────────────

def filter_candidates(items: List[Dict], occasion: Dict) -> Dict[str, List[Dict]]:
    """
    Partition items into role buckets, filtering out items whose formality
    is more than 2× the tolerance band away from the event formality.
    """
    event_formality = occasion.get("formality_level", 0.5)

    buckets: Dict[str, List[Dict]] = {
        "tops":        [],
        "bottoms":     [],
        "dresses":     [],
        "shoes":       [],
        "outerwear":   [],
        "accessories": [],
        "set":         [],
        "swimwear":    [],
        "loungewear":  [],
    }

    for item in items:
        formality_diff = abs(item.get("formality_score", 0.5) - event_formality)
        if formality_diff > FORMALITY_TOLERANCE * 2:
            continue  # too casual/formal for this event

        category = (item.get("category") or "").lower()
        if category in buckets:
            buckets[category].append(item)

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
) -> List[Dict]:
    """
    Rule-based accessory selection.
    Max 2 accessories, no two of the same subtype (e.g. two bags).
    """
    if not accessories:
        return []

    scored = [
        (score_outfit(core_outfit + [acc], occasion, user_body_type=user_body_type), acc)
        for acc in accessories
    ]
    scored.sort(key=lambda x: x[0], reverse=True)

    selected: List[Dict]        = []
    used_subtypes: Dict[str, int] = {}

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
    from the wardrobe but needed to unlock outfit templates.

    Rules:
      - No tops       → "Add at least one top to unlock outfit templates A and B"
      - No bottoms    → "Add at least one bottom (trousers, skirt…) to complete templates A and B"
      - No shoes      → "Add at least one pair of shoes — every template requires footwear"
      - No dresses    → "Add a dress to unlock templates C and D"
      - Tops+bottoms but no outerwear → optional hint about template B
    The function never returns an error if the minimum set (top+bottom+shoes OR dress+shoes)
    is present — it only flags what's missing relative to the four templates.
    """
    categories  = {(i.get("item_type") or "").lower() for i in user_items}
    categories |= {(i.get("category") or "").lower() for i in user_items}

    has_tops      = bool({"tops", "top"} & categories)
    has_bottoms   = bool({"bottoms", "bottom", "skirts", "trousers"} & categories)
    has_shoes     = bool({"shoes", "footwear"} & categories)
    has_dresses   = bool({"dresses", "dress"} & categories)
    has_outerwear = bool({"outerwear", "jackets", "jacket", "coat"} & categories)
    has_set       = bool({"set"} & categories)
    has_swimwear  = bool({"swimwear"} & categories)

    gaps: List[str] = []

    can_do_ab = has_tops and has_bottoms and has_shoes
    can_do_cd = has_dresses and has_shoes
    can_do_ef = has_set and has_shoes
    can_do_g  = has_swimwear and has_shoes

    if not can_do_ab and not can_do_cd and not can_do_ef and not can_do_g:
        # No template family possible — give targeted hints
        if not has_shoes:
            gaps.append("Add at least one pair of shoes — every outfit template requires footwear")
        if not has_tops and not has_dresses and not has_set:
            gaps.append("Add a top, dress, or co-ord set to start building outfits")
        elif not has_tops:
            gaps.append("Add at least one top to unlock outfit templates A and B")
        if not has_bottoms and not has_dresses and not has_set:
            gaps.append("Add a bottom (trousers or skirt), dress, or co-ord set to complete a look")
        elif not has_bottoms:
            gaps.append("Add at least one bottom (trousers or skirt) to complete templates A and B")
    else:
        # At least one template family works — give aspirational nudges
        if can_do_ab and not can_do_cd:
            gaps.append("Add a dress + shoes to unlock two additional outfit templates")
        if not has_outerwear and (can_do_ab or can_do_ef):
            gaps.append("Add a jacket or coat to unlock layered outfits (templates B, D, and F)")
        if not can_do_ef and not has_set:
            gaps.append("Add a co-ord set to unlock set outfit templates (E and F)")

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
    accessories  = buckets.pop("accessories", [])

    tops_list     = buckets.get("tops",      [])
    bottoms_list  = buckets.get("bottoms",   [])
    shoes_list    = buckets.get("shoes",     [])
    dresses_list  = buckets.get("dresses",   [])
    outer_list    = buckets.get("outerwear", [])
    sets_list     = buckets.get("set",       [])
    swimwear_list = buckets.get("swimwear",  [])

    # ── Build all candidate cores per template ────────────────────────────
    # Template A: top + bottom + shoes
    # Template B: top + bottom + outerwear + shoes
    # Template C: dress + shoes
    # Template D: dress + outerwear + shoes
    # Template E: set + shoes            (co-ord set covers top+bottom slot)
    # Template F: set + outerwear + shoes
    # Template G: swimwear + shoes       (beach/resort occasions)
    template_combos: Dict[str, List[List[Dict]]] = {
        "top_bottom_shoes":           [],
        "top_bottom_outerwear_shoes": [],
        "dress_shoes":                [],
        "dress_outerwear_shoes":      [],
        "set_shoes":                  [],
        "set_outerwear_shoes":        [],
        "swimwear_shoes":             [],
    }

    for top in tops_list:
        for bottom in bottoms_list:
            for shoe in shoes_list:
                template_combos["top_bottom_shoes"].append([top, bottom, shoe])

    for top in tops_list:
        for bottom in bottoms_list:
            for outer in outer_list:
                for shoe in shoes_list:
                    template_combos["top_bottom_outerwear_shoes"].append([top, bottom, outer, shoe])

    for dress in dresses_list:
        for shoe in shoes_list:
            template_combos["dress_shoes"].append([dress, shoe])

    for dress in dresses_list:
        for outer in outer_list:
            for shoe in shoes_list:
                template_combos["dress_outerwear_shoes"].append([dress, outer, shoe])

    for s in sets_list:
        for shoe in shoes_list:
            template_combos["set_shoes"].append([s, shoe])

    for s in sets_list:
        for outer in outer_list:
            for shoe in shoes_list:
                template_combos["set_outerwear_shoes"].append([s, outer, shoe])

    for sw in swimwear_list:
        for shoe in shoes_list:
            template_combos["swimwear_shoes"].append([sw, shoe])

    # ── Score combos, splitting fresh vs already-seen looks ──────────────
    fresh_best_per_template: List[Tuple[float, List[Dict], Dict]] = []
    fresh_overflow:          List[Tuple[float, List[Dict], Dict]] = []
    seen_best_per_template:  List[Tuple[float, List[Dict], Dict]] = []
    seen_overflow:           List[Tuple[float, List[Dict], Dict]] = []
    fresh_available = False

    for _tname, combos in template_combos.items():
        if not combos:
            continue

        fresh_scored_combos: List[Tuple[float, List[Dict], Dict]] = []
        seen_scored_combos: List[Tuple[float, List[Dict], Dict]] = []
        for c in combos:
            is_seen = frozenset(str(item["id"]) for item in c) in seen_sets
            fw = _outfit_feedback_weight(c, combo_weights)
            score, breakdown = score_outfit_v2(
                c, occasion,
                user_feedback_weight=fw,
                user_body_type=user_body_type,
                outfit_history_embeddings=_history,
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
            fresh_best_per_template.append(fresh_scored_combos[0])
            fresh_overflow.extend(fresh_scored_combos[1:])
        elif seen_scored_combos:
            seen_best_per_template.append(seen_scored_combos[0])
            seen_overflow.extend(seen_scored_combos[1:])

    if not fresh_available and not seen_best_per_template:
        logger.warning("Not enough items to form a complete outfit.")
        return [], False

    selected_pool = fresh_best_per_template if fresh_available else seen_best_per_template
    selected_overflow = fresh_overflow if fresh_available else seen_overflow

    selected_pool.sort(key=lambda x: x[0], reverse=True)
    top_cores = list(selected_pool[:top_n])

    if len(top_cores) < top_n and selected_overflow:
        selected_overflow.sort(key=lambda x: x[0], reverse=True)
        for entry in selected_overflow:
            if len(top_cores) >= top_n:
                break
            top_cores.append(entry)

    # ── Detect exhaustion: true only when no fresh combos remain ──────────
    all_seen = not fresh_available

    # ── Assemble final suggestions ────────────────────────────────────────
    suggestions = []
    for outfit_score, core_items, score_breakdown in top_cores:
        selected_accessories = attach_accessories(
            core_items, accessories, occasion, user_body_type=user_body_type
        )

        all_items = core_items + selected_accessories
        card      = _build_outfit_card(all_items, occasion, score_breakdown)

        is_seen = frozenset(str(i["id"]) for i in core_items) in seen_sets
        suggestion = {
            "id":              str(uuid4()),
            "user_id":         user_id,
            "event_id":        event_id,
            "item_ids":        [item["id"] for item in core_items],
            "accessory_ids":   [acc["id"] for acc in selected_accessories],
            "score":           outfit_score,
            "score_breakdown": score_breakdown,   # stripped before DB insert
            "explanation":     card["verdict"],   # short verdict kept in legacy column
            "card":            card,              # full structured card
            "user_rating":     None,
            "generated_at":    datetime.utcnow().isoformat(),
        }
        suggestions.append(suggestion)
        logger.info(
            "Outfit generated — score:%.3f composite:%.3f items:%d accessories:%d body_type:%s seen:%s",
            outfit_score, score_breakdown.get("composite", outfit_score),
            len(core_items), len(selected_accessories),
            user_body_type or "n/a", "yes" if is_seen else "no",
        )

    return suggestions, all_seen
