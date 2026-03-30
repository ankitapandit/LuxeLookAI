"""
services/recommender.py — Core outfit recommendation engine
=============================================================
Phase 1 scorer intelligence:

  score = w1*color_harmony + w2*formality + w3*season
        + w4*embedding_similarity + w5*preference + w6*style_coherence

  color_harmony   — HSL/RGB-based perceptual color theory (complementary, analogous, neutral)
  formality       — item-to-occasion formality alignment
  season          — temperature context match
  embedding       — CLIP pairwise cosine similarity (visual harmony)
  preference      — blend of feedback history + body-type silhouette priors
  style_coherence — pattern mixing penalty + fit consistency

Pipeline:
  1. Filter items to valid candidates for the occasion
  2. Build core outfit combinations across 4 structural templates
  3. Score each combination using the hybrid formula
  4. Attach up to 2 accessories per outfit using rule-based logic
  5. Generate LLM explanations for top-N outfits
  6. Return ranked suggestions
"""

from __future__ import annotations
import itertools
import logging
from typing import List, Dict, Any, Optional, Tuple
from uuid import uuid4
from datetime import datetime

from ml.embeddings import cosine_similarity
from ml.llm import explain_outfit

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

# ── Seen-combo penalty ─────────────────────────────────────────────────────────
# Previously shown outfits are not hard-excluded; they receive this multiplier so
# fresh combinations always surface first, but repeats still appear when the
# wardrobe doesn't have enough variety to fill top_n with all-new combos.
SEEN_PENALTY = 0.70

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
        "tops":    {"fit": ["fitted", "bodycon", "wrap", "tailored"],
                    "neckline": ["v-neck", "sweetheart", "plunging", "wrap"]},
        "bottoms": {"fit": ["fitted", "slim", "skinny"],
                    "leg_opening": ["straight", "skinny", "flare"]},
        "dresses": {"fit": ["fitted", "bodycon", "wrap"],
                    "length": ["midi", "knee", "mini"]},
        "outerwear": {"fit": ["fitted", "tailored"]},
    },
    "rectangle": {
        "tops":    {"fit": ["oversized", "relaxed", "boxy", "peplum"],
                    "neckline": ["scoop", "square", "off-shoulder", "sweetheart"]},
        "bottoms": {"fit": ["wide", "relaxed", "high-waist"],
                    "leg_opening": ["wide", "flare", "bootcut"]},
        "dresses": {"fit": ["a-line", "shift", "wrap", "peplum"],
                    "length": ["midi", "maxi"]},
        "outerwear": {"fit": ["oversized", "relaxed", "belted"]},
    },
    "pear": {
        "tops":    {"fit": ["oversized", "relaxed", "structured", "peplum"],
                    "neckline": ["boat", "off-shoulder", "square", "sweetheart", "scoop"]},
        "bottoms": {"fit": ["a-line", "relaxed"],
                    "leg_opening": ["flare", "wide", "bootcut"]},
        "dresses": {"fit": ["a-line", "wrap", "empire"],
                    "length": ["midi", "knee"]},
        "outerwear": {"fit": ["structured", "tailored"]},
    },
    "apple": {
        "tops":    {"fit": ["relaxed", "regular", "empire"],
                    "neckline": ["v-neck", "plunging", "scoop"]},
        "bottoms": {"fit": ["straight", "regular"],
                    "leg_opening": ["straight", "wide", "bootcut"]},
        "dresses": {"fit": ["empire", "wrap", "shift"],
                    "length": ["midi", "maxi"]},
        "outerwear": {"fit": ["open-front", "relaxed"]},
    },
    "inverted triangle": {
        "tops":    {"fit": ["regular", "relaxed"],
                    "neckline": ["crew", "turtleneck", "boat", "high-neck"]},
        "bottoms": {"fit": ["wide", "relaxed", "high-waist"],
                    "leg_opening": ["wide", "flare", "bootcut", "barrel"]},
        "dresses": {"fit": ["a-line", "wrap", "fit and flare"],
                    "length": ["midi", "maxi"]},
        "outerwear": {"fit": ["relaxed", "oversized"]},
    },
    "petite": {
        "tops":    {"fit": ["fitted", "slim", "cropped"],
                    "length": ["crop", "waist-length"]},
        "bottoms": {"fit": ["slim", "fitted", "skinny"],
                    "leg_opening": ["skinny", "straight", "tapered"]},
        "dresses": {"fit": ["shift", "fitted"],
                    "length": ["mini", "knee"]},
        "outerwear": {"fit": ["fitted", "cropped"]},
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

    rgb_a = COLOR_RGB.get(a)
    rgb_b = COLOR_RGB.get(b)

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

_OVERSIZED_FITS = {"oversized", "relaxed", "loose", "boxy", "slouchy"}
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

    prefs = BODY_TYPE_PREFERENCES.get(body_type.lower().strip())
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
) -> Tuple[List[Dict], bool]:
    """
    Main entry point for outfit generation.

    Args:
        user_items:             All clothing items belonging to the user (from DB).
        occasion:               Structured occasion dict (from LLM parsing).
        event_id:               UUID of the event row.
        user_id:                UUID of the requesting user.
        top_n:                  Number of outfit suggestions to return.
        user_profile:           Optional user profile dict (body_type priors).
        combo_feedback_weights: Occasion-scoped combo reputation map.
                                Keys are _combo_key strings; values are 0-1 weights.
                                Combos absent from the map default to neutral 0.5.
        seen_item_combos:       Item-ID sets shown in previous batches (accumulated).
                                These combos receive SEEN_PENALTY so fresh combos
                                always surface first.

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

    buckets      = filter_candidates(user_items, occasion)
    accessories  = buckets.pop("accessories", [])

    tops_list    = buckets.get("tops",      [])
    bottoms_list = buckets.get("bottoms",   [])
    shoes_list   = buckets.get("shoes",     [])
    dresses_list = buckets.get("dresses",   [])
    outer_list   = buckets.get("outerwear", [])

    # ── Build all candidate cores per template ────────────────────────────
    # Template A: top + bottom + shoes
    # Template B: top + bottom + outerwear + shoes
    # Template C: dress + shoes
    # Template D: dress + outerwear + shoes
    template_combos: Dict[str, List[List[Dict]]] = {
        "top_bottom_shoes":           [],
        "top_bottom_outerwear_shoes": [],
        "dress_shoes":                [],
        "dress_outerwear_shoes":      [],
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

    # ── Score combos, applying feedback weights + seen penalty ────────────
    best_per_template: List[Tuple[float, List[Dict]]] = []
    overflow:          List[Tuple[float, List[Dict]]] = []

    for _tname, combos in template_combos.items():
        if not combos:
            continue

        scored_combos: List[Tuple[float, List[Dict]]] = []
        for c in combos:
            # Per-outfit preference weight from occasion-scoped combo history
            fw    = _outfit_feedback_weight(c, combo_weights)
            score = score_outfit(c, occasion, user_feedback_weight=fw, user_body_type=user_body_type)

            # Soft downrank: previously shown combos yield to fresh alternatives
            if frozenset(str(item["id"]) for item in c) in seen_sets:
                score *= SEEN_PENALTY

            scored_combos.append((score, c))

        scored_combos.sort(key=lambda x: x[0], reverse=True)
        best_per_template.append(scored_combos[0])
        overflow.extend(scored_combos[1:])

    if not best_per_template:
        logger.warning("Not enough items to form a complete outfit.")
        return []

    best_per_template.sort(key=lambda x: x[0], reverse=True)
    top_cores = list(best_per_template[:top_n])

    if len(top_cores) < top_n and overflow:
        overflow.sort(key=lambda x: x[0], reverse=True)
        for entry in overflow:
            if len(top_cores) >= top_n:
                break
            top_cores.append(entry)

    # ── Detect exhaustion: all returned combos were previously shown ──────
    all_seen = bool(seen_sets) and all(
        frozenset(str(i["id"]) for i in core) in seen_sets
        for _, core in top_cores
    )

    # ── Assemble final suggestions ────────────────────────────────────────
    suggestions = []
    for outfit_score, core_items in top_cores:
        selected_accessories = attach_accessories(
            core_items, accessories, occasion, user_body_type=user_body_type
        )

        all_items   = core_items + selected_accessories
        explanation = explain_outfit(all_items, occasion)

        is_seen = frozenset(str(i["id"]) for i in core_items) in seen_sets
        suggestion = {
            "id":            str(uuid4()),
            "user_id":       user_id,
            "event_id":      event_id,
            "item_ids":      [item["id"] for item in core_items],
            "accessory_ids": [acc["id"] for acc in selected_accessories],
            "score":         outfit_score,
            "explanation":   explanation,
            "user_rating":   None,
            "generated_at":  datetime.utcnow().isoformat(),
        }
        suggestions.append(suggestion)
        logger.info(
            "Outfit generated — score:%.3f items:%d accessories:%d body_type:%s seen:%s",
            outfit_score, len(core_items), len(selected_accessories),
            user_body_type or "n/a", "yes" if is_seen else "no",
        )

    return suggestions, all_seen
