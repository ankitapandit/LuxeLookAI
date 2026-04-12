"""
services/season_rules.py — Season Rule Engine
==============================================
Attribute-based seasonal scoring for outfit suggestions.

Evaluates fabric weight, sleeve length, fit silhouette, pattern, and
insulation against the current season/temperature. Also enforces hard-reject
rules for thermally contradictory combinations.

Public API:
    score_season_rules(outfit_items, occasion) -> float  [0.0 – 1.0]

All existing scoring logic is untouched — this module is additive only.
"""

from __future__ import annotations
from typing import Dict, List, Optional, Tuple

# ── Season index helpers ──────────────────────────────────────────────────────
SEASONS = ("summer", "spring", "fall", "winter")
_SEASON_IDX = {s: i for i, s in enumerate(SEASONS)}

# ── 2.1 Attribute weight tables ───────────────────────────────────────────────
# Format: attribute_value -> (summer, spring, fall, winter)

FABRIC_WEIGHTS: Dict[str, Tuple[int, int, int, int]] = {
    "cotton":         (3, 2, 1, 0),
    "linen":          (4, 2, 0, 0),
    "rayon":          (3, 2, 0, 0),
    "bamboo":         (3, 2, 0, 0),
    "modal":          (2, 3, 1, 0),
    "chiffon":        (4, 2, 0, 0),
    "mesh":           (3, 1, 0, 0),
    "lace":           (2, 2, 1, 0),
    "satin":          (1, 2, 2, 1),
    "silk":           (1, 2, 2, 2),
    "jersey":         (1, 3, 2, 1),
    "knit":           (0, 2, 3, 3),
    "ribbed":         (0, 2, 3, 2),
    "waffle-knit":    (0, 1, 3, 3),
    "waffle_knit":    (0, 1, 3, 3),
    "denim":          (0, 1, 4, 2),
    "wool":           (0, 0, 2, 5),
    "fleece":         (0, 0, 1, 5),
    "tweed":          (0, 0, 3, 4),
    "leather":        (0, 0, 4, 3),
    "suede":          (0, 0, 4, 3),
    "faux fur":       (0, 0, 1, 5),
    "faux_fur":       (0, 0, 1, 5),
    "polyester":      (1, 2, 2, 1),
    "nylon":          (1, 2, 2, 2),
    "recycled nylon": (1, 2, 2, 2),
    "recycled_nylon": (1, 2, 2, 2),
    "spandex":        (1, 2, 1, 0),
    "elastane":       (1, 2, 1, 0),
    "lycra":          (1, 2, 1, 0),
    "terry":          (1, 1, 2, 3),
}

SLEEVE_WEIGHTS: Dict[str, Tuple[int, int, int, int]] = {
    "sleeveless": (4, 2, 0, 0),
    "cap":        (3, 2, 0, 0),
    "short":      (3, 3, 1, 0),
    "3/4":        (1, 4, 3, 1),
    "long":       (0, 2, 4, 4),
}

FIT_WEIGHTS: Dict[str, Tuple[int, int, int, int]] = {
    "slim":        (1, 2, 2, 2),
    "regular":     (2, 3, 2, 1),
    "relaxed":     (3, 3, 3, 1),
    "loose":       (4, 3, 2, 1),
    "oversized":   (2, 2, 3, 3),
    "bodycon":     (1, 2, 2, 1),
    "tailored":    (0, 2, 4, 4),
    "a-line":      (3, 4, 1, 0),
    "a_line":      (3, 4, 1, 0),
    "fit & flare": (3, 4, 1, 0),
    "fit_flare":   (3, 4, 1, 0),
    "wrap":        (3, 4, 2, 1),
}

PATTERN_WEIGHTS: Dict[str, Tuple[int, int, int, int]] = {
    "solid":        (2, 2, 2, 2),
    "floral":       (2, 5, 1, 0),
    "striped":      (3, 2, 2, 1),
    "stripe":       (3, 2, 2, 1),
    "graphic":      (2, 2, 2, 1),
    "abstract":     (2, 3, 2, 1),
    "tie-dye":      (4, 2, 0, 0),
    "tie_dye":      (4, 2, 0, 0),
    "plaid":        (0, 1, 5, 3),
    "animal print": (1, 1, 4, 2),
    "animal_print": (1, 1, 4, 2),
}

INSULATION_WEIGHTS: Dict[str, Tuple[int, int, int, int]] = {
    "lightweight":  (5, 3, 1, 0),
    "midweight":    (1, 4, 4, 2),
    "heavyweight":  (0, 0, 3, 4),
    "insulated":    (0, 0, 1, 5),
    "down-filled":  (0, 0, 0, 6),
    "down_filled":  (0, 0, 0, 6),
}

# Per-attribute maximum weights (used for normalization)
_FABRIC_MAX     = 5
_SLEEVE_MAX     = 4
_FIT_MAX        = 4
_PATTERN_MAX    = 5
_INSULATION_MAX = 6


# ── 2.2 Hard reject rules ─────────────────────────────────────────────────────
# Each entry: (set_of_bad_fabrics_or_sleeves, set_of_bad_insulations_or_fabrics2)
# Returns True if combination is a hard reject.

_AIRY_FABRICS   = {"chiffon", "mesh", "linen"}
_HEAVY_FABRICS  = {"wool", "fleece", "faux fur", "faux_fur", "tweed"}
_HEAVY_INSUL    = {"heavyweight", "insulated", "down-filled", "down_filled"}
_TIE_DYE        = {"tie-dye", "tie_dye"}
_HERITAGE_FAB   = {"tweed", "faux fur", "faux_fur"}


def _hard_reject(fabric: Optional[str], sleeve: Optional[str], insulation: Optional[str]) -> bool:
    """Return True if the attribute combination is thermally / aesthetically contradictory."""
    f = (fabric or "").lower().replace("-", "_")
    s = (sleeve or "").lower()
    i = (insulation or "").lower().replace("-", "_")

    # sleeveless + heavyweight / insulated / down-filled
    if s == "sleeveless" and i in {"heavyweight", "insulated", "down_filled"}:
        return True

    # chiffon / mesh + insulated / down-filled
    if f in {"chiffon", "mesh"} and i in {"insulated", "down_filled"}:
        return True

    # wool / fleece / faux_fur + sleeveless
    if f in {"wool", "fleece", "faux_fur"} and s == "sleeveless":
        return True

    # linen + down-filled
    if f == "linen" and i == "down_filled":
        return True

    # tie-dye + tweed / faux fur
    if f in {"tie_dye"} and fabric in {"tweed", "faux_fur"}:
        return True

    # bodycon + down-filled  (handled via fit — checked in caller)
    # wrap + down-filled      (handled via fit — checked in caller)

    return False


def _hard_reject_fit(fit: Optional[str], insulation: Optional[str]) -> bool:
    """Reject silhouette + insulation contradictions."""
    f = (fit or "").lower().replace("&", "").replace("  ", " ").strip()
    i = (insulation or "").lower().replace("-", "_")
    if f in {"bodycon", "wrap"} and i == "down_filled":
        return True
    return False


# ── Temperature → target season ───────────────────────────────────────────────

_TEMP_TO_SEASON: Dict[str, str] = {
    "hot":     "summer",
    "warm":    "summer",
    "mild":    "spring",   # spring/fall average handled below
    "cool":    "fall",
    "cold":    "winter",
    "indoor":  "spring",   # neutral/moderate
    "outdoor": "spring",   # moderate default
}

_AMBIGUOUS_TEMPS = {"mild", "indoor", "outdoor"}  # average spring + fall


def _season_weights(attribute_table: Dict[str, Tuple], key: str, season: str) -> Optional[float]:
    """
    Look up the normalised [0..1] weight for a given attribute value in a season.
    Returns None if the attribute value isn't in the table.
    """
    entry = attribute_table.get(key.lower().strip())
    if entry is None:
        return None
    idx = _SEASON_IDX.get(season)
    if idx is None:
        return None
    return float(entry[idx])


def _score_item_attributes(
    descriptors: dict,
    season: str,
    second_season: Optional[str] = None,
) -> Tuple[float, bool]:
    """
    Score a single item's descriptors against one (or two averaged) target seasons.
    Returns (normalised_score [0..1], is_hard_reject).
    """
    fabric     = (descriptors.get("fabric_type") or descriptors.get("fabric") or "").lower().strip()
    sleeve     = (descriptors.get("sleeve_length") or "").lower().strip()
    fit        = (descriptors.get("fit") or "").lower().strip()
    pattern    = (descriptors.get("pattern") or "").lower().strip()
    insulation = (descriptors.get("insulation") or "").lower().strip()

    # Hard reject check
    if _hard_reject(fabric, sleeve, insulation):
        return 0.0, True
    if _hard_reject_fit(fit, insulation):
        return 0.0, True

    def _get(table: Dict, key: str, max_val: int) -> Optional[float]:
        if not key:
            return None
        raw = _season_weights(table, key, season)
        if raw is None:
            return None
        if second_season:
            raw2 = _season_weights(table, key, second_season)
            if raw2 is not None:
                raw = (raw + raw2) / 2.0
        return raw / max_val  # normalise to [0..1]

    scores: List[float] = []
    for val, table, max_val in [
        (fabric,     FABRIC_WEIGHTS,     _FABRIC_MAX),
        (sleeve,     SLEEVE_WEIGHTS,     _SLEEVE_MAX),
        (fit,        FIT_WEIGHTS,        _FIT_MAX),
        (pattern,    PATTERN_WEIGHTS,    _PATTERN_MAX),
        (insulation, INSULATION_WEIGHTS, _INSULATION_MAX),
    ]:
        s = _get(table, val, max_val)
        if s is not None:
            scores.append(s)

    if not scores:
        return 0.5, False  # no descriptor data — neutral score

    return round(sum(scores) / len(scores), 4), False


# ── Public interface ──────────────────────────────────────────────────────────

def score_season_rules(outfit_items: List[Dict], occasion: Dict) -> float:
    """
    Score an outfit against seasonal attribute rules.

    Evaluates fabric weight, sleeve length, fit silhouette, pattern suitability,
    and insulation level for each item, then averages across the outfit.
    Hard-reject combinations (e.g. sleeveless + down-filled) return 0.0.

    Args:
        outfit_items: List of item dicts (must include "descriptors" dict and
                      optionally "category").
        occasion:     Structured occasion dict with "temperature_context" key.

    Returns:
        float in [0.0, 1.0] — higher is more seasonally appropriate.
        Falls back to 0.5 on any unexpected error.
    """
    try:
        if not outfit_items:
            return 0.5

        temp = (occasion.get("temperature_context") or "").lower().strip()
        primary_season = _TEMP_TO_SEASON.get(temp, "spring")
        second_season  = "fall" if temp in _AMBIGUOUS_TEMPS else None

        item_scores: List[float] = []
        hard_rejected = False

        for item in outfit_items:
            desc = item.get("descriptors") or {}
            if not isinstance(desc, dict):
                continue
            item_score, is_reject = _score_item_attributes(desc, primary_season, second_season)
            if is_reject:
                hard_rejected = True
                item_scores.append(0.0)
            else:
                item_scores.append(item_score)

        if not item_scores:
            return 0.5

        base = sum(item_scores) / len(item_scores)

        # Hard-reject outfits score no higher than 0.15
        if hard_rejected:
            base = min(base, 0.15)

        return round(base, 4)

    except Exception:
        return 0.5
