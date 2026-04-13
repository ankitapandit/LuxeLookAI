"""
services/taxonomy.py — Cached style taxonomy loader
=====================================================
Loads style vocabulary from the style_taxonomy DB table once per process.
In mock mode, returns the hardcoded Python constants directly (no DB call).

Five domains exposed:
  descriptor   → get_descriptors()   → Dict[category, Dict[attr, List[str]]]
  color        → get_color_rgb()     → Dict[name, (R, G, B)]
  clip_label   → get_clip_labels()   → Dict[attr, List[Tuple[value, prompt]]]
  body_type    → get_body_type_prefs() → Dict[body, Dict[cat, Dict[attr, List[str]]]]
  event_token  → get_event_tokens()  → (Set[activity_tokens], Set[setting_tokens])

All getters are process-level singletons (functools.cache).  The first real-mode
call hits Supabase; every subsequent call returns the in-memory copy instantly.
Fallback: if the DB query fails, the hardcoded Python constants are returned.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any, Dict, List, Set, Tuple

logger = logging.getLogger(__name__)


def _parse_meta(raw: Any) -> dict:
    """Safely parse the meta column — Supabase may return a dict or a JSON string."""
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return {}


# ─────────────────────────────────────────────────────────────────────────────
# Internal loader — fetches every row from the table once
# ─────────────────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _load_all() -> List[dict]:
    """
    Fetch every row from style_taxonomy and return as a plain list of dicts.
    Cached for the lifetime of the process.  Raises on DB error (callers fall back).
    """
    from utils.db import get_supabase
    db = get_supabase()
    resp = (
        db.table("style_taxonomy")
          .select("domain, category, attribute, value, meta, sort_order")
          .order("sort_order")
          .execute()
    )
    return resp.data or []


def _rows(domain: str) -> List[dict]:
    return [r for r in _load_all() if r["domain"] == domain]


def _merge_missing_labels(
    loaded: Dict[str, List[Tuple[str, str]]],
    fallback: Dict[str, List[Tuple[str, str]]],
) -> Dict[str, List[Tuple[str, str]]]:
    merged = {key: list(values) for key, values in loaded.items()}
    seen = {key: {value for value, _ in values} for key, values in merged.items()}
    for attr, labels in fallback.items():
        merged.setdefault(attr, [])
        seen.setdefault(attr, set())
        for value, prompt in labels:
            if value in seen[attr]:
                continue
            merged[attr].append((value, prompt))
            seen[attr].add(value)
    return merged


def _merge_missing_descriptors(
    loaded: Dict[str, Dict[str, List[str]]],
    fallback: Dict[str, Dict[str, List[str]]],
) -> Dict[str, Dict[str, List[str]]]:
    merged = {cat: {attr: list(values) for attr, values in attrs.items()} for cat, attrs in loaded.items()}
    for cat, attrs in fallback.items():
        merged.setdefault(cat, {})
        for attr, values in attrs.items():
            merged[cat].setdefault(attr, [])
            for value in values:
                if value not in merged[cat][attr]:
                    merged[cat][attr].append(value)
    return merged


# ─────────────────────────────────────────────────────────────────────────────
# Public getters — call these everywhere instead of the hardcoded constants
# ─────────────────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_descriptors() -> Dict[str, Dict[str, List[str]]]:
    """
    Returns CATEGORY_DESCRIPTORS shape:
      { "tops": { "fabric_type": ["cotton", ...], ... }, ... }
    """
    from config import get_settings
    if get_settings().use_mock_ai:
        from ml.llm import CATEGORY_DESCRIPTORS
        return CATEGORY_DESCRIPTORS

    try:
        out: Dict[str, Dict[str, List[str]]] = {}
        for row in _rows("descriptor"):
            cat  = row["category"]
            attr = row["attribute"]
            val  = row["value"]
            out.setdefault(cat, {}).setdefault(attr, []).append(val)
        if out:
            from ml.llm import CATEGORY_DESCRIPTORS
            return _merge_missing_descriptors(out, CATEGORY_DESCRIPTORS)
    except Exception as exc:
        logger.warning("taxonomy: descriptor load failed (%s) — using hardcoded fallback", exc)

    from ml.llm import CATEGORY_DESCRIPTORS
    return CATEGORY_DESCRIPTORS


@lru_cache(maxsize=1)
def get_color_rgb() -> Dict[str, Tuple[int, int, int]]:
    """
    Returns COLOR_RGB shape:
      { "black": (10, 10, 10), ... }
    """
    from config import get_settings
    if get_settings().use_mock_ai:
        from services.recommender import COLOR_RGB
        return COLOR_RGB

    try:
        out: Dict[str, Tuple[int, int, int]] = {}
        for row in _rows("color"):
            name = row["value"]
            meta = _parse_meta(row.get("meta"))
            r, g, b = meta.get("r"), meta.get("g"), meta.get("b")
            if r is not None:
                out[name] = (int(r), int(g), int(b))
        if out:
            return out
    except Exception as exc:
        logger.warning("taxonomy: color_rgb load failed (%s) — using hardcoded fallback", exc)

    from services.recommender import COLOR_RGB
    return COLOR_RGB


@lru_cache(maxsize=1)
def get_clip_labels() -> Dict[str, List[Tuple[str, str]]]:
    """
    Returns clip labels grouped by attribute:
      {
        "category":      [("tops", "a photo of..."), ...],
        "season":        [("summer", "..."), ...],
        "accessory_type": [("bag", "..."), ...],
        "jewelry_type":  [("necklace", "..."), ...],
      }
    """
    from config import get_settings
    if get_settings().use_mock_ai:
        from ml.tagger import CATEGORY_LABELS, SEASON_LABELS, ACCESSORY_LABELS, JEWELRY_LABELS
        return {
            "category":       CATEGORY_LABELS,
            "season":         SEASON_LABELS,
            "accessory_type": ACCESSORY_LABELS,
            "jewelry_type":   JEWELRY_LABELS,
        }

    try:
        out: Dict[str, List[Tuple[str, str]]] = {}
        for row in _rows("clip_label"):
            attr  = row["attribute"]
            val   = row["value"]
            meta  = _parse_meta(row.get("meta"))
            prompt = meta.get("clip_prompt", val)
            out.setdefault(attr, []).append((val, prompt))
        if out:
            from ml.tagger import CATEGORY_LABELS, SEASON_LABELS, ACCESSORY_LABELS, JEWELRY_LABELS
            return _merge_missing_labels(
                out,
                {
                    "category":       CATEGORY_LABELS,
                    "season":         SEASON_LABELS,
                    "accessory_type": ACCESSORY_LABELS,
                    "jewelry_type":   JEWELRY_LABELS,
                },
            )
    except Exception as exc:
        logger.warning("taxonomy: clip_label load failed (%s) — using hardcoded fallback", exc)

    from ml.tagger import CATEGORY_LABELS, SEASON_LABELS, ACCESSORY_LABELS, JEWELRY_LABELS
    return _merge_missing_labels(
        {
            "category":       CATEGORY_LABELS,
            "season":         SEASON_LABELS,
            "accessory_type": ACCESSORY_LABELS,
            "jewelry_type":   JEWELRY_LABELS,
        },
        {
            "category":       CATEGORY_LABELS,
            "season":         SEASON_LABELS,
            "accessory_type": ACCESSORY_LABELS,
            "jewelry_type":   JEWELRY_LABELS,
        },
    )


@lru_cache(maxsize=1)
def get_body_type_prefs() -> Dict[str, Dict[str, Dict[str, List[str]]]]:
    """
    Returns BODY_TYPE_PREFERENCES shape:
      { "hourglass": { "tops": { "fit": ["fitted", ...] }, ... }, ... }
    """
    from config import get_settings
    if get_settings().use_mock_ai:
        from services.recommender import BODY_TYPE_PREFERENCES
        return BODY_TYPE_PREFERENCES

    try:
        out: Dict[str, Dict[str, Dict[str, List[str]]]] = {}
        for row in _rows("body_type"):
            body_type = row["category"]
            # attribute is stored as "category_attribute" e.g. "tops_fit"
            attr_key  = row["attribute"]
            val       = row["value"]
            parts     = attr_key.split("_", 1)
            if len(parts) != 2:
                continue
            cat, attr = parts
            (
                out
                .setdefault(body_type, {})
                .setdefault(cat, {})
                .setdefault(attr, [])
                .append(val)
            )
        if out:
            return out
    except Exception as exc:
        logger.warning("taxonomy: body_type load failed (%s) — using hardcoded fallback", exc)

    from services.recommender import BODY_TYPE_PREFERENCES
    return BODY_TYPE_PREFERENCES


@lru_cache(maxsize=1)
def get_event_tokens() -> Tuple[Set[str], Set[str]]:
    """
    Returns (activity_tokens, setting_tokens) as sets.
    """
    from config import get_settings
    if get_settings().use_mock_ai:
        from routers.recommendations import _ACTIVITY_TOKENS, _SETTING_TOKENS
        return _ACTIVITY_TOKENS, _SETTING_TOKENS

    try:
        activity: Set[str] = set()
        setting:  Set[str] = set()
        for row in _rows("event_token"):
            meta = _parse_meta(row.get("meta"))
            tok  = row["value"]
            ttype = meta.get("token_type", "activity")
            if ttype == "activity":
                activity.add(tok)
            else:
                setting.add(tok)
        if activity or setting:
            return activity, setting
    except Exception as exc:
        logger.warning("taxonomy: event_token load failed (%s) — using hardcoded fallback", exc)

    from routers.recommendations import _ACTIVITY_TOKENS, _SETTING_TOKENS
    return _ACTIVITY_TOKENS, _SETTING_TOKENS


def invalidate_cache() -> None:
    """
    Clear all cached taxonomy data.  Call this after writing new rows to
    style_taxonomy (e.g., from an admin endpoint) so the next request
    reloads the updated vocabulary.
    """
    _load_all.cache_clear()
    get_descriptors.cache_clear()
    get_color_rgb.cache_clear()
    get_clip_labels.cache_clear()
    get_body_type_prefs.cache_clear()
    get_event_tokens.cache_clear()
