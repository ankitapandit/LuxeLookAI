"""
services/style_images.py — Pexels image enrichment for style direction pieces
==============================================================================
Fetches one representative Pexels image per wearable style-direction piece so
the frontend can render a visual moodboard alongside the editorial text.

Wearable labels (eligible for image fetch):
  garments   : Top, Base, Bottom, Dress, Set, Swimwear
  footwear   : Shoes, Footwear
  outerwear  : Outerwear
  accessories: Bag, Accessories, Accessory, Jewelry

Non-wearable labels (text-only, skipped):
  Hair, Makeup, Sunscreen, Nails, Fragrance, …
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

# ── Labels eligible for a Pexels image fetch ─────────────────────────────────
_WEARABLE_LABELS: Set[str] = {
    "top", "base", "bottom", "dress", "set", "swimwear",
    "shoes", "footwear",
    "outerwear",
    "bag", "accessories", "accessory", "jewelry",
}

# Filler phrases that add no search signal
_GENERIC_RE = re.compile(
    r"\b(your anchor (?:piece|item|swimwear|top|bottom|dress|set)?[^,]*"
    r"|as the hero|no cover-up needed|optional|always)\b",
    re.IGNORECASE,
)
_PUNCT_RE = re.compile(r"[,\.;:—–]")

# Canonical suffix per label to land Pexels results in fashion territory
_LABEL_SUFFIX: Dict[str, str] = {
    "top":         "fashion top outfit",
    "base":        "fashion blouse top",
    "bottom":      "fashion trousers skirt",
    "dress":       "fashion dress outfit",
    "set":         "fashion co-ord set",
    "swimwear":    "swimwear beach fashion",
    "shoes":       "fashion shoes",
    "footwear":    "fashion shoes",
    "outerwear":   "jacket coat fashion",
    "bag":         "handbag fashion",
    "accessories": "fashion accessories",
    "accessory":   "fashion accessories",
    "jewelry":     "jewelry fashion",
}


def _resolve_label(label: str) -> Optional[str]:
    """
    Return the canonical wearable token for a label, or None if non-wearable.

    Handles composite labels such as "Top/Base/Dress" by checking each
    slash-separated part against _WEARABLE_LABELS.
    Returns the first matching token so _LABEL_SUFFIX lookups always work.
    """
    parts = [p.strip() for p in label.lower().split("/") if p.strip()]
    for part in parts:
        if part in _WEARABLE_LABELS:
            return part
    return None


def _build_piece_query(canonical_label: str, value: str) -> str:
    """
    Build a concise Pexels search query from a resolved canonical label + description.

    1. Strip generic filler phrases from the value.
    2. Take the first 5 meaningful words.
    3. Append the canonical label's fashion suffix.
    """
    cleaned = _GENERIC_RE.sub("", value)
    cleaned = _PUNCT_RE.sub(" ", cleaned).strip()
    words = [w for w in cleaned.split() if len(w) > 1][:5]
    core = " ".join(words).strip()
    suffix = _LABEL_SUFFIX.get(canonical_label, f"{canonical_label} fashion")
    parts = [p for p in [core, suffix] if p]
    return " ".join(parts)


def _fetch_piece_image(canonical_label: str, value: str) -> Optional[str]:
    """Return one Pexels image_url for a wearable piece, or None on any failure."""
    from services.discover_search import _pexels_search

    query = _build_piece_query(canonical_label, value)
    try:
        results = _pexels_search(query, limit=3)
        if results:
            r = results[0]
            return r.get("image_url") or r.get("thumbnail_url")
    except Exception as exc:
        logger.debug("style_images: pexels fetch failed for %r — %s", query, exc)
    return None


def enrich_style_direction_images(
    style_direction: Dict[str, Any],
    event: Dict[str, Any],  # reserved for future context-aware query tuning
) -> Dict[str, Any]:
    """
    Return a copy of *style_direction* with ``image_url`` added to every piece.

    Wearable pieces (including composite labels like "Top/Base/Dress") get a
    real Pexels URL (or None on failure).
    Non-wearable pieces always get ``image_url: None``.
    The original dict is never mutated.
    """
    if not style_direction or not style_direction.get("options"):
        return style_direction

    enriched_options: List[Dict[str, Any]] = []
    for option in style_direction["options"]:
        enriched_pieces: List[Dict[str, Any]] = []
        for piece in option.get("pieces", []):
            label = str(piece.get("label") or "")
            value = str(piece.get("value") or "")
            image_url: Optional[str] = None
            canonical = _resolve_label(label)
            if canonical:
                image_url = _fetch_piece_image(canonical, value)
            enriched_pieces.append({**piece, "image_url": image_url})
        enriched_options.append({**option, "pieces": enriched_pieces})

    return {**style_direction, "options": enriched_options}
