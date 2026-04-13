"""
services/trend_service.py — Seasonal fashion trend scoring
===========================================================

Loads trend_calendar.json and scores outfit attributes against the
current season's trends.

Data source
-----------
trend_calendar.json is pre-built from the Myntra Fashion Product Images
Dataset (MIT license — paramaggarwal/fashion-product-images-dataset on
Kaggle) and editorial curation.  Refresh it each season by running:

    python scripts/build_trend_calendar.py path/to/styles.csv

The calendar maps four dimensions to 0–1 trend scores per season:
  colors       — item color trend popularity for the season
  vibe         — which outfit vibes are culturally dominant
  color_theory — which palette strategies are trending
  fit_check    — which silhouette/fit is ascendant

Scoring
-------
score_trend() blends three signals:
  40% — color trend score (outfit item colors vs season's trending palette)
  35% — attribute trend score (predicted vibe + color_theory + fit_check)
  25% — unused weight redistributed when signals are unavailable

All missing values default to 0.50 (neutral), so outfits are never
penalised simply because the calendar doesn't recognise a value.
"""

import json
import os
from datetime import date
from typing import Dict, List, Optional

_CALENDAR_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "trend_calendar.json")
_calendar: Optional[Dict] = None


def _load_calendar() -> Dict:
    global _calendar
    if _calendar is None:
        try:
            with open(_CALENDAR_PATH) as f:
                _calendar = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            _calendar = {}
    return _calendar


def current_season() -> str:
    """Return the current meteorological season based on today's date."""
    month = date.today().month
    if month in (3, 4, 5):  return "spring"
    if month in (6, 7, 8):  return "summer"
    if month in (9, 10, 11): return "fall"
    return "winter"


def score_trend(
    item_colors: List[str],
    predicted_attrs: Dict[str, str],
    season: Optional[str] = None,
) -> float:
    """
    Score how on-trend this outfit is for the current (or specified) season.

    Parameters
    ----------
    item_colors     : list of raw color strings from outfit items
                      (e.g. ["black", "white", "beige"])
    predicted_attrs : dict with keys vibe, color_theory, fit_check, trend_label
                      as produced by _predict_outfit_attrs() in recommender.py
    season          : override season key ("spring"|"summer"|"fall"|"winter").
                      Defaults to current_season() when None.

    Returns
    -------
    float in [0.0, 1.0].  0.50 when calendar missing or no signals available.
    """
    try:
        calendar = _load_calendar()
        if not calendar:
            return 0.50

        season_key  = (season or current_season()).lower()
        season_data = calendar.get(season_key, {})
        if not season_data:
            return 0.50

        scores:  List[float] = []
        weights: List[float] = []

        # ── Signal 1: color trend (40%) ──────────────────────────────────────
        color_data = season_data.get("colors", {})
        if item_colors and color_data:
            color_hits = [
                color_data.get(c.lower().strip(), 0.50)
                for c in item_colors if c
            ]
            if color_hits:
                scores.append(sum(color_hits) / len(color_hits))
                weights.append(0.40)

        # ── Signal 2: attribute trend (35% shared across vibe/theory/fit) ───
        attr_hits: List[float] = []
        for attr in ("vibe", "color_theory", "fit_check"):
            val       = predicted_attrs.get(attr)
            attr_data = season_data.get(attr, {})
            if val and attr_data:
                attr_hits.append(attr_data.get(val, 0.50))
        if attr_hits:
            scores.append(sum(attr_hits) / len(attr_hits))
            weights.append(0.35)

        if not scores:
            return 0.50

        # Normalise by actual weight sum (handles missing signals gracefully)
        total_weight   = sum(weights)
        weighted_score = sum(s * w for s, w in zip(scores, weights)) / total_weight
        return round(min(1.0, max(0.0, weighted_score)), 4)

    except Exception:
        return 0.50


def invalidate_cache() -> None:
    """Force reload of trend_calendar.json on next call (useful after refresh)."""
    global _calendar
    _calendar = None
