"""
services/style_catalog.py — Canonical style vocabulary for Discover
====================================================================
This module defines the normalized style vocabulary used by the Discover
feed, swipe logging, and preference aggregation.

The data is stored in Supabase in public.style_catalog. In mock mode, or if
the table is empty, the hardcoded fallback below is used.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Tuple

from config import get_settings

logger = logging.getLogger(__name__)


DEFAULT_STYLE_CATALOG: List[Dict[str, Any]] = [
    {"style_key": "tailored", "label": "Tailored", "dimension": "silhouette", "description": "Clean, shaped, precise through the body.", "aliases": ["structured tailoring", "shaped"], "sort_order": 1},
    {"style_key": "structured", "label": "Structured", "dimension": "silhouette", "description": "Built with clear lines and visible shape.", "aliases": ["sharp", "architectural"], "sort_order": 2},
    {"style_key": "relaxed", "label": "Relaxed", "dimension": "silhouette", "description": "Easy, unfussy, and comfortable without feeling sloppy.", "aliases": ["easy", "casual"], "sort_order": 3},
    {"style_key": "oversized", "label": "Oversized", "dimension": "silhouette", "description": "Intentional volume with a loose, roomy shape.", "aliases": ["boxy", "baggy"], "sort_order": 4},
    {"style_key": "fitted", "label": "Fitted", "dimension": "silhouette", "description": "Close to the body and visually clean.", "aliases": ["slim", "snug"], "sort_order": 5},
    {"style_key": "flowing", "label": "Flowing", "dimension": "silhouette", "description": "Soft movement and fluid drape.", "aliases": ["draped", "fluid"], "sort_order": 6},
    {"style_key": "sharp", "label": "Sharp", "dimension": "silhouette", "description": "Crisp edges and defined lines.", "aliases": ["clean line"], "sort_order": 7},
    {"style_key": "longline", "label": "Longline", "dimension": "silhouette", "description": "Extended length that elongates the body.", "aliases": ["elongated"], "sort_order": 8},
    {"style_key": "cropped", "label": "Cropped", "dimension": "silhouette", "description": "Shortened length that reveals the waist or ankle.", "aliases": ["shortened"], "sort_order": 9},
    {"style_key": "a_line", "label": "A-line", "dimension": "silhouette", "description": "Flares gently away from the body.", "aliases": ["fit and flare"], "sort_order": 10},
    {"style_key": "bodycon", "label": "Bodycon", "dimension": "silhouette", "description": "Very close fit with a body-skimming line.", "aliases": ["figure-hugging"], "sort_order": 11},
    {"style_key": "draped", "label": "Draped", "dimension": "silhouette", "description": "Soft folds or gathered structure shape the garment.", "aliases": ["gathered"], "sort_order": 12},
    {"style_key": "boxy", "label": "Boxy", "dimension": "silhouette", "description": "Square cut with a straight outline.", "aliases": ["square cut"], "sort_order": 13},
    {"style_key": "cinched", "label": "Cinched", "dimension": "silhouette", "description": "Pulled in at the waist or body to define shape.", "aliases": ["waisted"], "sort_order": 14},

    {"style_key": "wool", "label": "Wool", "dimension": "fabric", "description": "Warm, insulating, cool-weather weight.", "aliases": ["knit wool"], "sort_order": 20},
    {"style_key": "knit", "label": "Knit", "dimension": "fabric", "description": "Looped or sweater-like texture.", "aliases": ["sweater knit"], "sort_order": 21},
    {"style_key": "linen", "label": "Linen", "dimension": "fabric", "description": "Breathable, airy, and warm-weather friendly.", "aliases": ["linen blend"], "sort_order": 22},
    {"style_key": "denim", "label": "Denim", "dimension": "fabric", "description": "Sturdy woven cotton with a casual edge.", "aliases": ["jean"], "sort_order": 23},
    {"style_key": "satin", "label": "Satin", "dimension": "fabric", "description": "Smooth, reflective, and softly glossy.", "aliases": ["silky"], "sort_order": 24},
    {"style_key": "silk", "label": "Silk", "dimension": "fabric", "description": "Light, fluid, and refined.", "aliases": ["silken"], "sort_order": 25},
    {"style_key": "leather", "label": "Leather", "dimension": "fabric", "description": "Smooth or textured leather finish.", "aliases": ["faux leather"], "sort_order": 26},
    {"style_key": "suede", "label": "Suede", "dimension": "fabric", "description": "Soft brushed leather surface.", "aliases": ["nubuck"], "sort_order": 27},
    {"style_key": "tweed", "label": "Tweed", "dimension": "fabric", "description": "Dense, textured, heritage fabric.", "aliases": ["boucle", "herringbone"], "sort_order": 28},
    {"style_key": "lace", "label": "Lace", "dimension": "fabric", "description": "Openwork, delicate, and decorative.", "aliases": ["sheer lace"], "sort_order": 29},
    {"style_key": "mesh", "label": "Mesh", "dimension": "fabric", "description": "Open, airy, and lightly transparent.", "aliases": ["net"], "sort_order": 30},
    {"style_key": "chiffon", "label": "Chiffon", "dimension": "fabric", "description": "Sheer, floaty, and airy.", "aliases": ["floaty"], "sort_order": 31},
    {"style_key": "cotton", "label": "Cotton", "dimension": "fabric", "description": "Natural, breathable, everyday fabric.", "aliases": ["cotton blend"], "sort_order": 32},
    {"style_key": "textured", "label": "Textured", "dimension": "fabric", "description": "Noticeable surface texture or weave.", "aliases": ["heathered", "ribbed"], "sort_order": 33},

    {"style_key": "solid", "label": "Solid", "dimension": "pattern", "description": "Single tone or unpatterned surface.", "aliases": ["plain"], "sort_order": 40},
    {"style_key": "plaid", "label": "Plaid", "dimension": "pattern", "description": "Checks, tartan, or plaid grid.", "aliases": ["tartan", "check"], "sort_order": 41},
    {"style_key": "stripe", "label": "Stripe", "dimension": "pattern", "description": "Striped or pinstripe surface.", "aliases": ["striped"], "sort_order": 42},
    {"style_key": "floral", "label": "Floral", "dimension": "pattern", "description": "Flower-based print or embroidery.", "aliases": ["botanical"], "sort_order": 43},
    {"style_key": "animal_print", "label": "Animal Print", "dimension": "pattern", "description": "Leopard, zebra, snake, or similar animal-inspired print.", "aliases": ["leopard", "zebra", "snake"], "sort_order": 44},
    {"style_key": "polka_dot", "label": "Polka Dot", "dimension": "pattern", "description": "Dot-based repeat print.", "aliases": ["dots"], "sort_order": 45},
    {"style_key": "geometric", "label": "Geometric", "dimension": "pattern", "description": "Angular or repeated geometric print.", "aliases": ["graphic"], "sort_order": 46},
    {"style_key": "abstract", "label": "Abstract", "dimension": "pattern", "description": "Painterly or non-literal print.", "aliases": ["art print"], "sort_order": 47},

    {"style_key": "neutral", "label": "Neutral", "dimension": "color_family", "description": "Soft, muted, and easy-to-pair tones.", "aliases": ["neutrals"], "sort_order": 60},
    {"style_key": "monochrome", "label": "Monochrome", "dimension": "color_family", "description": "Single-color story or near-single palette.", "aliases": ["tonal"], "sort_order": 61},
    {"style_key": "warm", "label": "Warm", "dimension": "color_family", "description": "Warm undertone palette.", "aliases": ["golden"], "sort_order": 62},
    {"style_key": "cool", "label": "Cool", "dimension": "color_family", "description": "Cool undertone palette.", "aliases": ["icy"], "sort_order": 63},
    {"style_key": "earth", "label": "Earth", "dimension": "color_family", "description": "Olive, rust, camel, brown, and other grounded tones.", "aliases": ["earthy"], "sort_order": 64},
    {"style_key": "bright", "label": "Bright", "dimension": "color_family", "description": "Clear, vivid, or saturated color story.", "aliases": ["vibrant"], "sort_order": 65},
    {"style_key": "dark", "label": "Dark", "dimension": "color_family", "description": "Deep or low-light palette.", "aliases": ["deep tone"], "sort_order": 66},
    {"style_key": "soft_pastel", "label": "Soft Pastel", "dimension": "color_family", "description": "Light, gentle, and airy palette.", "aliases": ["pastel"], "sort_order": 67},

    {"style_key": "minimal", "label": "Minimal", "dimension": "vibe", "description": "Clean, quiet, and restrained.", "aliases": ["clean"], "sort_order": 80},
    {"style_key": "polished", "label": "Polished", "dimension": "vibe", "description": "Finished, composed, and deliberate.", "aliases": ["refined"], "sort_order": 81},
    {"style_key": "romantic", "label": "Romantic", "dimension": "vibe", "description": "Soft, feminine, and charming.", "aliases": ["soft feminine"], "sort_order": 82},
    {"style_key": "playful", "label": "Playful", "dimension": "vibe", "description": "Light, fun, and a little unexpected.", "aliases": ["fun"], "sort_order": 83},
    {"style_key": "classic", "label": "Classic", "dimension": "vibe", "description": "Timeless and familiar in a good way.", "aliases": ["timeless"], "sort_order": 84},
    {"style_key": "modern", "label": "Modern", "dimension": "vibe", "description": "Current and crisp without feeling trendy-first.", "aliases": ["contemporary"], "sort_order": 85},
    {"style_key": "dramatic", "label": "Dramatic", "dimension": "vibe", "description": "High contrast, strong presence, or statement energy.", "aliases": ["bold"], "sort_order": 86},
    {"style_key": "edgy", "label": "Edgy", "dimension": "vibe", "description": "Sharper, cooler, or slightly rebellious.", "aliases": ["cool-girl"], "sort_order": 87},
    {"style_key": "elevated", "label": "Elevated", "dimension": "vibe", "description": "Polished but not overly formal.", "aliases": ["upsized"], "sort_order": 88},
    {"style_key": "casual", "label": "Casual", "dimension": "vibe", "description": "Relaxed everyday ease.", "aliases": ["everyday"], "sort_order": 89},
    {"style_key": "statement", "label": "Statement", "dimension": "vibe", "description": "Designed to stand out and get noticed.", "aliases": ["bold statement"], "sort_order": 90},
    {"style_key": "cozy", "label": "Cozy", "dimension": "vibe", "description": "Soft, warm, and comfortable.", "aliases": ["snug"], "sort_order": 91},
    {"style_key": "layered", "label": "Layered", "dimension": "styling_detail", "description": "Built from multiple visible layers.", "aliases": ["stacked"], "sort_order": 92},
    {"style_key": "clean", "label": "Clean", "dimension": "styling_detail", "description": "No-fuss styling with minimal clutter.", "aliases": ["simple"], "sort_order": 93},
    {"style_key": "sleek", "label": "Sleek", "dimension": "styling_detail", "description": "Smooth, streamlined, and neat.", "aliases": ["streamlined"], "sort_order": 94},
    {"style_key": "feminine", "label": "Feminine", "dimension": "styling_detail", "description": "Soft, graceful, and traditionally feminine styling cues.", "aliases": ["soft feminine"], "sort_order": 95},
    {"style_key": "sporty", "label": "Sporty", "dimension": "styling_detail", "description": "Athletic or activewear-inspired styling.", "aliases": ["athletic"], "sort_order": 96},
    {"style_key": "structured_detail", "label": "Structured", "dimension": "styling_detail", "description": "Visible tailoring or strong shape in the detailing.", "aliases": ["sharp detail"], "sort_order": 97},

    {"style_key": "top", "label": "Top", "dimension": "garment_type", "description": "Upper-body garment.", "aliases": ["tops"], "sort_order": 110},
    {"style_key": "bottom", "label": "Bottom", "dimension": "garment_type", "description": "Lower-body garment.", "aliases": ["bottoms"], "sort_order": 111},
    {"style_key": "dress", "label": "Dress", "dimension": "garment_type", "description": "One-piece dress garment.", "aliases": ["dresses"], "sort_order": 112},
    {"style_key": "jumpsuit", "label": "Jumpsuit", "dimension": "garment_type", "description": "One-piece jumpsuit or romper silhouette.", "aliases": ["romper", "playsuit"], "sort_order": 113},
    {"style_key": "outerwear", "label": "Outerwear", "dimension": "garment_type", "description": "Coats, jackets, blazers, and layers.", "aliases": ["layer"], "sort_order": 114},
    {"style_key": "shoes", "label": "Shoes", "dimension": "garment_type", "description": "Footwear and shoe styling.", "aliases": ["footwear"], "sort_order": 115},
    {"style_key": "accessory", "label": "Accessory", "dimension": "garment_type", "description": "Bags, belts, scarves, hats, sunglasses, and hair accessories as non-jewelry finishing pieces.", "aliases": ["accessories", "hair accessories", "hair accessory", "headband", "barrette", "claw clip"], "sort_order": 116},
    {"style_key": "jewelry", "label": "Jewelry", "dimension": "garment_type", "description": "Necklaces, earrings, bracelets, rings, watches, and other jewelry pieces.", "aliases": ["jewellery"], "sort_order": 117},
    {"style_key": "set", "label": "Set", "dimension": "garment_type", "description": "Matching two-piece outfit.", "aliases": ["coord", "co-ord"], "sort_order": 118},
    {"style_key": "swimwear", "label": "Swimwear", "dimension": "garment_type", "description": "Swim and resort garments.", "aliases": ["swim"], "sort_order": 119},
    {"style_key": "loungewear", "label": "Loungewear", "dimension": "garment_type", "description": "Comfort-focused indoor or at-home wear.", "aliases": ["lounge"], "sort_order": 120},

    {"style_key": "spring", "label": "Spring", "dimension": "season", "description": "Light layering and mild-weather dressing.", "aliases": ["spring weather"], "sort_order": 130},
    {"style_key": "summer", "label": "Summer", "dimension": "season", "description": "Hot-weather, breathable dressing.", "aliases": ["summer weather"], "sort_order": 131},
    {"style_key": "fall", "label": "Fall", "dimension": "season", "description": "Cool-weather, medium-weight dressing.", "aliases": ["autumn"], "sort_order": 132},
    {"style_key": "winter", "label": "Winter", "dimension": "season", "description": "Cold-weather, insulating dressing.", "aliases": ["winter weather"], "sort_order": 133},
    {"style_key": "all", "label": "All Season", "dimension": "season", "description": "Works year-round.", "aliases": ["all-season"], "sort_order": 134},

    {"style_key": "casual_event", "label": "Casual", "dimension": "occasion", "description": "Easy, informal social setting.", "aliases": ["casual occasion"], "sort_order": 150},
    {"style_key": "smart_casual", "label": "Smart Casual", "dimension": "occasion", "description": "Polished but relaxed.", "aliases": ["smart casual"], "sort_order": 151},
    {"style_key": "business", "label": "Business", "dimension": "occasion", "description": "Work or professional setting.", "aliases": ["office"], "sort_order": 152},
    {"style_key": "formal", "label": "Formal", "dimension": "occasion", "description": "Dress-up, event, or refined evening setting.", "aliases": ["dressy"], "sort_order": 153},
    {"style_key": "party", "label": "Party", "dimension": "occasion", "description": "Social or celebratory setting.", "aliases": ["night out"], "sort_order": 154},
    {"style_key": "date", "label": "Date", "dimension": "occasion", "description": "Date-night, romantic, or intimate setting.", "aliases": ["date night"], "sort_order": 155},
    {"style_key": "travel", "label": "Travel", "dimension": "occasion", "description": "Packable, movable, and comfortable for transit.", "aliases": ["airport"], "sort_order": 156},
    {"style_key": "resort", "label": "Resort", "dimension": "occasion", "description": "Vacation, destination, or leisure styling.", "aliases": ["vacation"], "sort_order": 157},
]


def _parse_aliases(raw: Any) -> List[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(value).strip().lower() for value in raw if str(value).strip()]
    if isinstance(raw, dict):
        return [str(value).strip().lower() for value in raw.values() if str(value).strip()]
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(value).strip().lower() for value in parsed if str(value).strip()]
    except Exception:
        pass
    return []


def _merge_missing_catalog(
    loaded: List[Dict[str, Any]],
    fallback: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    merged = [dict(row) for row in loaded]
    seen = {str(row.get("style_key") or "").strip().lower() for row in merged if row.get("style_key")}
    for row in fallback:
        key = str(row.get("style_key") or "").strip().lower()
        if not key or key in seen:
            continue
        merged.append(dict(row))
        seen.add(key)
    return sorted(merged, key=lambda row: int(row.get("sort_order", 0) or 0))


@lru_cache(maxsize=1)
def get_style_catalog() -> List[Dict[str, Any]]:
    """
    Return the canonical style catalog.
    If the style_catalog table is unavailable or empty, the hardcoded fallback is used.
    """
    if get_settings().use_mock_auth:
        return DEFAULT_STYLE_CATALOG

    try:
        from utils.db import get_supabase

        resp = (
            get_supabase()
            .table("style_catalog")
            .select("id, style_key, label, dimension, description, aliases, sort_order, is_active")
            .eq("is_active", True)
            .order("sort_order")
            .execute()
        )
        rows = resp.data or []
        if rows:
            loaded = [
                {
                    "id": row.get("id"),
                    "style_key": row.get("style_key"),
                    "label": row.get("label"),
                    "dimension": row.get("dimension"),
                    "description": row.get("description"),
                    "aliases": _parse_aliases(row.get("aliases")),
                    "sort_order": row.get("sort_order", 0),
                }
                for row in rows
            ]
            return _merge_missing_catalog(loaded, DEFAULT_STYLE_CATALOG)
    except Exception as exc:
        logger.warning("style_catalog load failed (%s) — using fallback", exc)

    return DEFAULT_STYLE_CATALOG


@lru_cache(maxsize=1)
def get_style_lookup() -> Dict[str, Dict[str, Any]]:
    lookup: Dict[str, Dict[str, Any]] = {}
    for row in get_style_catalog():
        style_key = str(row["style_key"]).strip().lower()
        lookup[style_key] = row
        lookup[str(row["label"]).strip().lower()] = row
        for alias in row.get("aliases") or []:
            lookup[str(alias).strip().lower()] = row
    return lookup


@lru_cache(maxsize=1)
def get_style_lookup_by_id() -> Dict[str, Dict[str, Any]]:
    lookup: Dict[str, Dict[str, Any]] = {}
    for row in get_style_catalog():
        row_id = row.get("id")
        if row_id:
            lookup[str(row_id)] = row
        lookup[str(row["style_key"]).strip().lower()] = row
    return lookup


def normalize_style_tag(tag: str) -> str:
    return (
        tag.strip()
        .lower()
        .replace("&", " and ")
        .replace("/", " ")
        .replace("-", "_")
        .replace(" ", "_")
    )


def get_style_ids_for_tags(tags: Iterable[str]) -> Tuple[List[str], List[str]]:
    """
    Resolve canonical style IDs + labels for a list of raw tags.
    Unknown tags are ignored.
    """
    lookup = get_style_lookup()
    ids: List[str] = []
    labels: List[str] = []
    seen: set[str] = set()

    for raw_tag in tags:
        normalized = normalize_style_tag(str(raw_tag))
        row = lookup.get(normalized) or lookup.get(normalized.replace("_", " "))
        if not row:
            continue
        row_id = str(row.get("id") or row["style_key"])
        if row_id in seen:
            continue
        seen.add(row_id)
        ids.append(row_id)
        labels.append(str(row.get("label") or row["style_key"]))
    return ids, labels


def get_style_catalog_prompt_block(limit: int = 64) -> str:
    """
    Render a compact allowed-tags block for image analysis prompts.
    The prompt should prefer style_key values, not labels.
    """
    rows = get_style_catalog()[:limit]
    return "\n".join(
        f"- {row['style_key']}: {row.get('label')} ({row.get('dimension')})"
        for row in rows
    )
