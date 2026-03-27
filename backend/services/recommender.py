"""
services/recommender.py — Core outfit recommendation engine
=============================================================
Implements the hybrid scoring formula from the spec:

  score = w1*color_score + w2*formality_score + w3*season_score
        + w4*embedding_similarity + w5*user_preference_weight

Pipeline:
  1. Filter items to valid candidates for the occasion
  2. Build core outfit combinations (top+bottom+shoes OR dress+shoes)
  3. Score each combination using the hybrid formula
  4. Attach up to 2 accessories per outfit using rule-based logic
  5. Generate LLM explanations for top-N outfits
  6. Return ranked suggestions
"""

from __future__ import annotations
import itertools
import logging
from typing import List, Dict, Any, Optional
from uuid import uuid4
from datetime import datetime

from ml.embeddings import cosine_similarity
from ml.llm import explain_outfit

logger = logging.getLogger(__name__)

# ── Scoring weights (tunable) ─────────────────────────────────────────────────
WEIGHTS = {
    "color":            0.20,
    "formality":        0.25,
    "season":           0.30,
    "embedding":        0.15,
    "user_preference":  0.10,
}

# ── Formality threshold — items within this band are considered compatible ───
FORMALITY_TOLERANCE = 0.25

# ── Color compatibility rules ─────────────────────────────────────────────────
# Pairs that score 1.0 (neutrals always work together)
NEUTRAL_COLORS = {"black", "white", "beige", "grey", "navy", "brown"}

# Pairs that score 0.0 (hard clashes)
COLOR_CLASHES: set[frozenset] = {
    frozenset({"red", "pink"}),
    frozenset({"orange", "red"}),
}


# ─────────────────────────────────────────────────────────────────────────────
# Scoring helpers
# ─────────────────────────────────────────────────────────────────────────────

def score_color_compatibility(color_a: str, color_b: str) -> float:
    """
    Returns 0.0–1.0 representing how well two colors work together.
    Neutrals always score 1.0; hard clashes score 0.0; others 0.6 (neutral/unknown).
    """
    a, b = color_a.lower(), color_b.lower()
    if a == b:
        return 0.9  # monochromatic — good but not perfect
    if a in NEUTRAL_COLORS or b in NEUTRAL_COLORS:
        return 1.0  # neutrals pair with anything
    if frozenset({a, b}) in COLOR_CLASHES:
        return 0.0
    return 0.6  # unknown pairing — moderate score


def score_formality_alignment(item_formality: float, event_formality: float) -> float:
    """
    Returns 1.0 if item formality is within tolerance of the event formality,
    scaling down linearly outside that band.
    """
    diff = abs(item_formality - event_formality)
    if diff <= FORMALITY_TOLERANCE:
        return 1.0
    # Linear decay beyond tolerance
    return max(0.0, 1.0 - (diff - FORMALITY_TOLERANCE) / (1.0 - FORMALITY_TOLERANCE))


def score_season_compatibility(item_season: str, event_temperature: str) -> float:
    """
    Returns 1.0 for season match or 'all' items, 0.0 for hard mismatch.
    """
    if item_season == "all":
        return 1.0
    season_temp_map = {
        "summer":  ["warm", "outdoor", "hot"],
        "winter":  ["cold", "indoor"],
        "spring":  ["mild", "outdoor", "indoor"],
        "fall":    ["mild", "cool", "indoor"],
    }
    compatible = season_temp_map.get(item_season, [])
    temp = (event_temperature or "").lower()
    return 1.0 if any(t in temp for t in compatible) else 0.5


def compute_outfit_embedding_score(items: List[Dict]) -> float:
    """
    Compute average pairwise cosine similarity across all items in the outfit.
    Items with higher visual harmony score higher.
    """
    embeddings = [item["embedding_vector"] for item in items if item.get("embedding_vector")]
    if len(embeddings) < 2:
        return 0.5  # not enough data to score

    pairs   = list(itertools.combinations(embeddings, 2))
    total   = sum(cosine_similarity(a, b) for a, b in pairs)
    average = total / len(pairs)

    # Cosine similarity ∈ [-1, 1]; map to [0, 1]
    return (average + 1.0) / 2.0


def score_outfit(
    outfit_items: List[Dict],
    occasion: Dict,
    user_feedback_weight: float = 0.5,
) -> float:
    """
    Compute the composite hybrid score for an outfit.

    Args:
        outfit_items:         List of item dicts (must have color, formality_score, season).
        occasion:             Structured occasion dict (formality_level, temperature_context).
        user_feedback_weight: Pre-computed preference signal (0–1); defaults to neutral 0.5.

    Returns:
        Float score in [0, 1].
    """
    event_formality = occasion.get("formality_level", 0.5)
    temperature     = occasion.get("temperature_context", "")

    # ── Color score: average pairwise compatibility ───────────────────────
    color_pairs = list(itertools.combinations(
        [item.get("color", "black") for item in outfit_items], 2
    ))
    color_score = (
        sum(score_color_compatibility(a, b) for a, b in color_pairs) / len(color_pairs)
        if color_pairs else 1.0
    )

    # ── Formality score: average item-to-event alignment ─────────────────
    formality_score = sum(
        score_formality_alignment(item.get("formality_score", 0.5), event_formality)
        for item in outfit_items
    ) / len(outfit_items)

    # ── Season score: average item-to-temperature compatibility ──────────
    season_score = sum(
        score_season_compatibility(item.get("season", "all"), temperature)
        for item in outfit_items
    ) / len(outfit_items)

    # ── Embedding similarity ──────────────────────────────────────────────
    embedding_score = compute_outfit_embedding_score(outfit_items)

    # ── Composite score ───────────────────────────────────────────────────
    final = (
        WEIGHTS["color"]           * color_score
        + WEIGHTS["formality"]     * formality_score
        + WEIGHTS["season"]        * season_score
        + WEIGHTS["embedding"]     * embedding_score
        + WEIGHTS["user_preference"] * user_feedback_weight
    )

    logger.debug(
        f"Outfit score breakdown — color:{color_score:.2f} formality:{formality_score:.2f} "
        f"season:{season_score:.2f} embedding:{embedding_score:.2f} → {final:.3f}"
    )
    return round(final, 4)


# ─────────────────────────────────────────────────────────────────────────────
# Item filtering
# ─────────────────────────────────────────────────────────────────────────────

def filter_candidates(items: List[Dict], occasion: Dict) -> Dict[str, List[Dict]]:
    """
    Partition items into buckets by role, applying rule-based filters.
    Returns a dict: {tops, bottoms, dresses, shoes, outerwear, accessories}
    """
    event_formality = occasion.get("formality_level", 0.5)
    temperature     = occasion.get("temperature_context", "")

    buckets: Dict[str, List[Dict]] = {
        "tops":        [],
        "bottoms":     [],
        "dresses":     [],
        "shoes":       [],
        "outerwear":   [],
        "accessories": [],
    }

    for item in items:
        # Hard filter: formality must be within 2× tolerance
        formality_diff = abs(item.get("formality_score", 0.5) - event_formality)
        if formality_diff > FORMALITY_TOLERANCE * 2:
            continue  # too casual/formal for this event

        category = item.get("category", "").lower()
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
    max_accessories: int = 2,
) -> List[Dict]:
    """
    Rule-based accessory selection:
    - Maximum 2 accessories per outfit
    - Avoid two bags or two belts (accessory overload rule)
    - Score each accessory against the outfit and pick the best
    """
    if not accessories:
        return []

    scored = []
    for acc in accessories:
        # Score the accessory as if it were part of the outfit
        combined = core_outfit + [acc]
        s = score_outfit(combined, occasion)
        scored.append((s, acc))

    scored.sort(key=lambda x: x[0], reverse=True)

    selected     = []
    used_subtypes: Dict[str, int] = {}

    for _, acc in scored:
        if len(selected) >= max_accessories:
            break
        subtype = acc.get("accessory_subtype", "other")
        # Avoid stacking same accessory subtype (e.g. 2 bags)
        if used_subtypes.get(subtype, 0) >= 1:
            continue
        selected.append(acc)
        used_subtypes[subtype] = used_subtypes.get(subtype, 0) + 1

    return selected


# ─────────────────────────────────────────────────────────────────────────────
# Main recommendation function
# ─────────────────────────────────────────────────────────────────────────────

def generate_outfit_suggestions(
    user_items: List[Dict],
    occasion: Dict,
    event_id: str,
    user_id: str,
    top_n: int = 3,
) -> List[Dict]:
    """
    Main entry point for outfit generation.

    Args:
        user_items: All clothing items belonging to the user (from DB).
        occasion:   Structured occasion dict (from LLM parsing).
        event_id:   UUID of the event row.
        user_id:    UUID of the requesting user.
        top_n:      Number of outfit suggestions to return.

    Returns:
        List of outfit suggestion dicts ready for DB insertion.
    """
    buckets = filter_candidates(user_items, occasion)
    accessories = buckets.pop("accessories", [])

    tops_list    = buckets.get("tops",      [])
    bottoms_list = buckets.get("bottoms",   [])
    shoes_list   = buckets.get("shoes",     [])
    dresses_list = buckets.get("dresses",   [])
    outer_list   = buckets.get("outerwear", [])

    # ── Build candidate cores grouped by template ─────────────────────────
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

    # ── Pick the best outfit per template, then fill to top_n ────────────
    # Priority: one unique template type per slot; overflow fills remaining
    best_per_template: List[tuple] = []   # (score, core_items)
    overflow: List[tuple] = []            # (score, core_items) — runner-ups

    for tname, combos in template_combos.items():
        if not combos:
            continue
        scored = sorted(
            [(score_outfit(c, occasion), c) for c in combos],
            key=lambda x: x[0], reverse=True,
        )
        best_per_template.append(scored[0])          # best of this template
        overflow.extend(scored[1:])                  # the rest

    if not best_per_template:
        logger.warning("Not enough items to form a complete outfit.")
        return []

    # Sort the per-template bests by score and take up to top_n
    best_per_template.sort(key=lambda x: x[0], reverse=True)
    top_cores = list(best_per_template[:top_n])

    # If still short of top_n, pad with best overflow combos
    if len(top_cores) < top_n and overflow:
        overflow.sort(key=lambda x: x[0], reverse=True)
        for entry in overflow:
            if len(top_cores) >= top_n:
                break
            top_cores.append(entry)

    # ── Assemble final suggestions ────────────────────────────────────────
    suggestions = []
    for outfit_score, core_items in top_cores:
        selected_accessories = attach_accessories(core_items, accessories, occasion)

        all_items  = core_items + selected_accessories
        explanation = explain_outfit(all_items, occasion)

        suggestion = {
            "id":             str(uuid4()),
            "user_id":        user_id,
            "event_id":       event_id,
            "item_ids":       [item["id"] for item in core_items],
            "accessory_ids":  [acc["id"] for acc in selected_accessories],
            "score":          outfit_score,
            "explanation":    explanation,
            "user_rating":    None,
            "generated_at":   datetime.utcnow().isoformat(),
        }
        suggestions.append(suggestion)
        logger.info(f"Outfit generated — score:{outfit_score:.3f} items:{len(core_items)} accessories:{len(selected_accessories)}")

    return suggestions
