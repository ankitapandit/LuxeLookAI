"""
ml/tagger.py — Clothing attribute extraction
=============================================
Three modes controlled by .env flags:
  USE_MOCK_AI=true   → deterministic random tags, zero setup needed.
  USE_MOCK_AI=false  → attempt real CLIP; on failure falls back gracefully
                       and sets needs_review=True so frontend shows manual form.

─── Fallback contract ─────────────────────────────────────────────────────────
If CLIP fails (model not downloaded, OOM, etc.) the function:
  1. Logs the full error
  2. Returns placeholder values with needs_review=True
  3. Does NOT raise — upload still succeeds; user fills in tags via review UI
───────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations
import hashlib
import logging
import random
from typing import Dict, Any, List, Tuple

from config import get_settings

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Label definitions — (canonical_value, descriptive_prompt) tuples.
# Descriptive prompts dramatically improve CLIP zero-shot accuracy.
# ─────────────────────────────────────────────────────────────────────────────

CATEGORY_LABELS: List[Tuple[str, str]] = [
    ("tops",        "a photo of a top, t-shirt, blouse, shirt, or sweater worn on the upper body"),
    ("bottoms",     "a photo of trousers, jeans, skirt, shorts, or pants worn on the lower body"),
    ("dresses",     "a photo of a dress or jumpsuit that covers both the torso and legs"),
    ("shoes",       "a photo of shoes, boots, heels, sneakers, sandals, or footwear"),
    ("outerwear",   "a photo of a coat, jacket, blazer, or cardigan worn as an outer layer"),
    ("accessories", "a photo of an accessory such as a handbag, jewelry, belt, scarf, or hat"),
    ("set",         "a photo of a co-ord set or matching two-piece outfit with a coordinated top and bottom in the same fabric or print"),
    ("swimwear",    "a photo of swimwear such as a bikini, one-piece swimsuit, tankini, monokini, or swim dress"),
    ("loungewear",  "a photo of loungewear, pajamas, sweatpants, joggers, a hoodie, or comfortable home or sleepwear clothing"),
]

COLOR_LABELS: List[Tuple[str, str]] = [
    ("black",   "this clothing item is black or very dark charcoal"),
    ("white",   "this clothing item is white or off-white or cream coloured"),
    ("navy",    "this clothing item is navy blue or dark blue"),
    ("beige",   "this clothing item is beige, tan, camel, or khaki coloured"),
    ("red",     "this clothing item is red or burgundy or wine coloured"),
    ("green",   "this clothing item is green, olive, or forest green coloured"),
    ("grey",    "this clothing item is grey or silver coloured"),
    ("brown",   "this clothing item is brown or chocolate or caramel coloured"),
    ("pink",    "this clothing item is pink, blush, or rose coloured"),
    ("blue",    "this clothing item is blue or light blue or sky blue coloured"),
    ("yellow",  "this clothing item is yellow or mustard or gold coloured"),
    ("orange",  "this clothing item is orange or rust or terracotta coloured"),
    ("purple",  "this clothing item is purple, violet, or lavender coloured"),
    ("pattern", "this clothing item has a pattern: stripes, floral, plaid, or print"),
]

SEASON_LABELS: List[Tuple[str, str]] = [
    ("summer", "lightweight summer clothing — thin fabric, sleeveless, breathable, for hot weather"),
    ("winter", "heavy winter clothing — thick fabric, warm, insulating, for cold weather"),
    ("spring", "light layering piece for mild spring or autumn weather"),
    ("fall",   "medium weight clothing suitable for cool autumn or fall weather"),
    ("all",    "a versatile, all-season clothing item suitable for any time of year"),
]

# Formality: weighted average across 5 numeric levels → continuous 0–1 score
# FORMALITY_LABELS: List[Tuple[float, str]] = [
#     (0.95, "very formal luxury eveningwear — black tie, gown, tuxedo, formal suit"),
#     (0.75, "smart formal clothing — business formal, blazer, dress shirt, tailored trousers"),
#     (0.55, "smart casual clothing — neat, polished but relaxed — chinos, blouse, casual dress"),
#     (0.30, "casual everyday clothing — comfortable, relaxed — jeans, t-shirt, casual top"),
#     (0.10, "very casual loungewear or sportswear — athletic, gym wear, streetwear, hoodies"),
# ]
FORMALITY_LABELS: List[Tuple[float, str]] = [
    (0.95, "a formal evening gown, tuxedo, tailored suit or black tie attire with luxurious fabric and fine detailing"),
    (0.78, "a smart formal blouse, tailored trousers, blazer, structured dress or button-down shirt suitable for office or formal dinner"),
    (0.62, "a smart casual top, fitted dress, stylish knit, neat chinos or polished casual wear suitable for a restaurant or party"),
    (0.38, "casual everyday clothing such as a plain t-shirt, jeans, relaxed fit top or simple comfortable garment"),
    (0.12, "very casual sportswear, loungewear, hoodie, athletic wear, gym clothes or street casual clothing"),
]

ACCESSORY_LABELS: List[Tuple[str, str]] = [
    ("bag",     "a handbag, purse, tote bag, clutch, or backpack"),
    ("jewelry", "jewelry such as a necklace, earrings, bracelet, ring, or watch"),
    ("belt",    "a belt worn around the waist"),
    ("scarf",   "a scarf, wrap, or shawl worn around the neck or shoulders"),
    ("hat",     "a hat, cap, or headwear"),
    ("other",   "another type of accessory or fashion item"),
]

# Human-readable season descriptions shown in the frontend review form.
SEASON_DESCRIPTIONS: Dict[str, str] = {
    "summer": "Hot weather — light, breathable fabrics",
    "winter": "Cold weather — thick, warm, insulating",
    "spring": "Mild weather — light layering pieces",
    "fall":   "Cool weather — medium weight fabrics",
    "all":    "Versatile — works year-round",
}

# Human-readable formality options for the frontend.
# User picks a named level; backend maps it to a numeric score.
FORMALITY_DESCRIPTIONS: List[Tuple[str, float, str]] = [
    # (display_label,    score, tooltip_hint)
    ("Black tie",        0.95,  "Gown, tuxedo, formal suit"),
    ("Business formal",  0.75,  "Blazer, tailored trousers, dress shirt"),
    ("Smart casual",     0.55,  "Chinos, blouse, casual dress — neat but relaxed"),
    ("Casual",           0.30,  "Everyday comfort — jeans, t-shirt"),
    ("Loungewear",       0.10,  "Gym wear, athleisure, hoodies"),
]


# ─────────────────────────────────────────────────────────────────────────────
# Lazy-loaded CLIP pipeline
# ─────────────────────────────────────────────────────────────────────────────
_clip_pipeline = None


def _get_clip_pipeline():
    """
    Load the CLIP zero-shot pipeline once and cache it in module scope.
    First call downloads ~600MB from HuggingFace (cached locally afterwards).
    Raises RuntimeError on failure so the caller can catch and fall back.
    """
    global _clip_pipeline
    if _clip_pipeline is None:
        try:
            from transformers import pipeline
            logger.info("Loading CLIP pipeline — first call may download ~600MB…")
            _clip_pipeline = pipeline(
                "zero-shot-image-classification",
                model="openai/clip-vit-base-patch32",
            )
            logger.info("CLIP pipeline ready.")
        except Exception as e:
            raise RuntimeError(f"CLIP model failed to load: {e}") from e
    return _clip_pipeline


def _classify(image, label_pairs: list) -> Tuple[str, float]:
    """
    Score an image against (value, prompt) pairs with CLIP.
    Returns (winning_canonical_value, confidence 0–1).
    """
    classifier = _get_clip_pipeline()
    prompts    = [prompt for _, prompt in label_pairs]
    values     = [value  for value, _ in label_pairs]

    results     = classifier(image, candidate_labels=prompts)
    best_prompt = results[0]["label"]
    best_score  = results[0]["score"]
    best_value  = values[prompts.index(best_prompt)]
    return best_value, best_score


def _compute_formality_score(image) -> float:
    """
    Continuous formality score (0–1) as a probability-weighted average
    across the 5 formality levels. More nuanced than a hard argmax.
    """
    classifier   = _get_clip_pipeline()
    prompts      = [prompt for _, prompt in FORMALITY_LABELS]
    results      = classifier(image, candidate_labels=prompts)
    weighted_sum = sum(r["score"] * FORMALITY_LABELS[prompts.index(r["label"])][0] for r in results)
    total_weight = sum(r["score"] for r in results)
    return round(weighted_sum / total_weight, 3) if total_weight > 0 else 0.5


# ─────────────────────────────────────────────────────────────────────────────
# Real CLIP tagging
# ─────────────────────────────────────────────────────────────────────────────

def _real_tag(image_bytes: bytes) -> Dict[str, Any]:
    """Run full CLIP attribute extraction. Returns needs_review=False on success."""
    from PIL import Image
    import io

    image    = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    logger.info("Running CLIP zero-shot classification…")

    from services.taxonomy import get_clip_labels
    _clip = get_clip_labels()
    category, cat_conf   = _classify(image, _clip.get("category", CATEGORY_LABELS))
    color,    color_conf = _classify(image, _clip.get("color", COLOR_LABELS))
    season,   _          = _classify(image, _clip.get("season", SEASON_LABELS))
    formality_score      = _compute_formality_score(image)

    # Category-based formality floor — prevents obviously dressable items
    # from being scored too casually by CLIP
    CATEGORY_FORMALITY_FLOOR = {
        "tops": 0.42,  # blouses/shirts are at least smart casual
        "bottoms": 0.40,
        "dresses": 0.55,  # dresses default to at least smart casual
        "shoes": 0.45,
        "outerwear": 0.50,
        "accessories": 0.40,
    }
    floor = CATEGORY_FORMALITY_FLOOR.get(category, 0.0)
    formality_score = max(formality_score, floor)

    logger.debug(
        f"CLIP results → category:{category}({cat_conf:.2f}) "
        f"color:{color}({color_conf:.2f}) season:{season} formality:{formality_score}"
    )

    item_type = (
        "accessory"    if category == "accessories" else
        "footwear"     if category == "shoes"       else
        "outerwear"    if category == "outerwear"   else
        "core_garment"
    )

    accessory_subtype = None
    if item_type == "accessory":
        accessory_subtype, _ = _classify(image, _clip.get("accessory_type", ACCESSORY_LABELS))

    return {
        "category":          category,
        "item_type":         item_type,
        "accessory_subtype": accessory_subtype,
        "color":             color,
        "season":            season,
        "formality_score":   formality_score,
        # needs_review=False means AI is confident — show tags as pre-filled suggestions
        # (user can still override any field)
        "needs_review":      False,
        "ai_confidence": {
            "category": round(cat_conf, 2),
            "color":    round(color_conf, 2),
        },
    }


def _fallback_tags() -> Dict[str, Any]:
    """
    Safe placeholder returned when CLIP fails.
    needs_review=True signals the frontend to open the full manual form immediately
    rather than showing pre-filled AI suggestions.
    """
    return {
        "category":          "tops",
        "item_type":         "core_garment",
        "accessory_subtype": None,
        "color":             "black",
        "season":            "all",
        "formality_score":   0.5,
        "needs_review":      True,   # ← key: frontend shows manual form
        "ai_confidence":     {},
        "descriptors": {},
    }


# ─────────────────────────────────────────────────────────────────────────────
# Mock tagging (USE_MOCK_AI=true)
# ─────────────────────────────────────────────────────────────────────────────

_MOCK_CATEGORIES = [v for v, _ in CATEGORY_LABELS]
_MOCK_COLORS     = [v for v, _ in COLOR_LABELS]
_MOCK_SEASONS    = [v for v, _ in SEASON_LABELS]
_MOCK_ACC_TYPES  = [v for v, _ in ACCESSORY_LABELS]


def _mock_tag(image_url: str) -> Dict[str, Any]:
    """
    Deterministic mock tags derived from URL hash.
    needs_review=True so the review form always shows in mock mode,
    making it easy to test the full manual-correction flow.
    """
    seed      = int(hashlib.md5(image_url.encode()).hexdigest(), 16) % (2**32)
    rng       = random.Random(seed)
    category  = rng.choice(_MOCK_CATEGORIES)
    item_type = (
        "accessory"    if category == "accessories" else
        "footwear"     if category == "shoes"       else
        "outerwear"    if category == "outerwear"   else
        "core_garment"
    )
    return {
        "category":          category,
        "item_type":         item_type,
        "accessory_subtype": rng.choice(_MOCK_ACC_TYPES) if item_type == "accessory" else None,
        "color":             rng.choice(_MOCK_COLORS),
        "season":            rng.choice(_MOCK_SEASONS),
        "formality_score":   round(rng.uniform(0.0, 1.0), 2),
        "needs_review":      True,
        "ai_confidence":     {},
        "descriptors": {},
    }


# ─────────────────────────────────────────────────────────────────────────────
# Public interface
# ─────────────────────────────────────────────────────────────────────────────

def tag_clothing_item(image_url: str, image_bytes: bytes = None) -> Dict[str, Any]:
    """
    Extract structured clothing attributes from an image.

    Returns dict with:
      category, item_type, accessory_subtype, color, season,
      formality_score, needs_review, ai_confidence
    """
    settings = get_settings()

    if settings.use_mock_ai:
        logger.debug("[MOCK] Tagging item — returning random tags, not reading image")
        tags = _mock_tag(image_url)
        from ml.llm import _mock_describe_clothing
        tags["descriptors"] = _mock_describe_clothing(tags["category"])
        return tags

    if image_bytes is None:
        raise ValueError("image_bytes is required when USE_MOCK_AI=false")

    try:
        tags = _real_tag(image_bytes)
    except Exception as e:
        # CLIP unavailable — degrade gracefully, let user fill tags manually
        logger.warning(f"CLIP tagging failed → falling back to manual review. Reason: {e}")
        tags = _fallback_tags()

    # Descriptor detection — best-effort, never fails the upload
    try:
        from ml.llm import describe_clothing
        tags["descriptors"] = describe_clothing(image_bytes, tags["category"])
    except Exception as e:
        logger.warning(f"Descriptor detection failed: {e}")
        tags["descriptors"] = {}

    return tags


def get_taggable_options() -> Dict[str, Any]:
    """
    Return all valid label values and their human-readable descriptions.
    Called by the frontend to populate correction dropdowns and review forms.
    Kept in sync with the model's label lists above.
    """
    from services.taxonomy import get_clip_labels
    _clip = get_clip_labels()
    _cats    = _clip.get("category", CATEGORY_LABELS)
    _colors  = _clip.get("color", COLOR_LABELS)
    _seasons = _clip.get("season", SEASON_LABELS)
    return {
        "categories": [v for v, _ in _cats],
        "colors":     [v for v, _ in _colors],
        # Season options enriched with human descriptions for the review form
        "seasons": [
            {"value": v, "label": SEASON_DESCRIPTIONS.get(v, v)}
            for v, _ in _seasons
        ],
        # Formality levels — user picks a named level, not a raw number
        "formality_levels": [
            {"label": label, "score": score, "description": desc}
            for label, score, desc in FORMALITY_DESCRIPTIONS
        ],
    }
