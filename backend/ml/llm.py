"""
ml/llm.py — LLM-powered occasion parsing and outfit explanation
================================================================
Two responsibilities:
  1. parse_occasion   — free text → structured Event JSON
  2. explain_outfit   — item list → human-readable styling rationale

MOCK mode  → returns hardcoded plausible responses (no OpenAI key needed).
REAL mode  → calls OpenAI gpt-4o-mini (cheap, fast, sufficient for V1).
"""

from __future__ import annotations
import json
import logging
from typing import Dict, Any, List

from config import get_settings

logger = logging.getLogger(__name__)


# ── Mock responses ────────────────────────────────────────────────────────────

_MOCK_OCCASIONS = [
    {"occasion_type": "formal",   "formality_level": 0.9, "temperature_context": "indoor", "setting": "restaurant"},
    {"occasion_type": "casual",   "formality_level": 0.2, "temperature_context": "outdoor", "setting": "park"},
    {"occasion_type": "business", "formality_level": 0.7, "temperature_context": "indoor", "setting": "office"},
    {"occasion_type": "party",    "formality_level": 0.6, "temperature_context": "indoor", "setting": "venue"},
    {"occasion_type": "date",     "formality_level": 0.5, "temperature_context": "indoor", "setting": "bar"},
]

_MOCK_EXPLANATIONS = [
    "This outfit pairs a classic silhouette with complementary tones that suit the occasion perfectly. The accessories add a polished finishing touch without overwhelming the look.",
    "A harmonious blend of textures and formality levels makes this ensemble versatile yet intentional. The color palette creates visual cohesion from head to toe.",
    "The balance between structure and ease here reflects the setting beautifully. Each piece earns its place — nothing is extraneous.",
]


def _mock_parse_occasion(raw_text: str) -> Dict[str, Any]:
    """Keyword-based mock — much more accurate than cycling hardcoded stubs."""
    text = raw_text.lower()

    # Venue / setting
    indoor_words  = ["club", "lounge", "bar", "restaurant", "indoor", "office",
                     "gallery", "museum", "gala", "wedding", "hall", "venue"]
    outdoor_words = ["park", "beach", "garden", "outdoor", "festival",
                     "rooftop", "bbq", "picnic", "hiking"]
    setting = "indoor"  if any(w in text for w in indoor_words)  else \
              "outdoor" if any(w in text for w in outdoor_words) else "mixed"

    # Temperature
    cold_words = ["cold", "winter", "freezing", "chilly", "coat", "night",
                  "january", "february", "november", "december"]
    cool_words = ["cool", "autumn", "fall", "october", "march", "evening"]
    hot_words  = ["hot", "summer", "beach", "july", "august", "sunny"]
    temp = "cold"  if any(w in text for w in cold_words) else \
           "cool"  if any(w in text for w in cool_words) else \
           "hot"   if any(w in text for w in hot_words)  else "warm"

    # Occasion + formality
    if any(w in text for w in ["black tie", "gala", "awards", "formal dinner", "wedding"]):
        occasion, formality = "formal", 0.90
    elif any(w in text for w in ["interview", "conference", "business", "meeting", "office"]):
        occasion, formality = "business", 0.75
    elif any(w in text for w in ["club", "lounge", "party", "farewell", "birthday",
                                   "celebration", "cocktail", "drinks", "night out"]):
        occasion, formality = "party", 0.62
    elif any(w in text for w in ["dinner", "restaurant", "date", "brunch"]):
        occasion, formality = "smart_casual", 0.58
    elif any(w in text for w in ["beach", "bbq", "picnic", "casual", "hangout", "chill"]):
        occasion, formality = "casual", 0.20
    elif any(w in text for w in ["gym", "hike", "run", "sport", "workout", "athletic"]):
        occasion, formality = "athletic", 0.10
    else:
        occasion, formality = "casual", 0.35

    return {
        "occasion_type":       occasion,
        "formality_level":     formality,
        "setting":             setting,
        "temperature_context": temp,
    }


def _mock_explain_outfit(items: List[Dict]) -> str:
    """Return a mock explanation cycling through canned responses."""
    idx = len(items) % len(_MOCK_EXPLANATIONS)
    return _MOCK_EXPLANATIONS[idx]


# ── Real LLM calls ────────────────────────────────────────────────────────────

def _real_parse_occasion(raw_text: str) -> Dict[str, Any]:
    """
    Send the user's free-text occasion description to GPT-4o-mini
    and extract a structured JSON object.
    """
    from openai import OpenAI

    client  = OpenAI(api_key=get_settings().openai_api_key)
    prompt = f"""You are an expert fashion stylist who understands dress codes, venues, body type, fashion trend forecasts and history, color theory and social occasions. Extract structured data from this event description.

    Event: "{raw_text}"

    Return ONLY valid JSON with exactly these fields:
    {{
      "occasion_type": "one of: formal, business, smart_casual, casual, party, outdoor, athletic",
      "formality_level": <float 0.0-1.0 where 0=very casual, 0.5=smart casual, 0.8=formal, 1.0=black tie>,
      "setting": "one of: indoor, outdoor, mixed",
      "temperature_context": "one of: hot, warm, cool, cold"
    }}

    Rules:
    - A club, lounge, bar, restaurant, gala, wedding = indoor
    - Park, beach, festival, garden = outdoor  
    - Office, conference = indoor
    - If weather/season hints at cold (night, winter, November-February) → temperature_context = cold or cool
    - A farewell party, birthday, club night = party, formality 0.55-0.7
    - Black tie, gala, awards = formal, formality 0.85-1.0
    - Beach bbq, picnic, casual hangout = casual, formality 0.1-0.3
    - Work meeting, conference = business, formality 0.7-0.85
    - 'fancy', 'dress up', 'dressy', 'upscale', 'lounge', 'rooftop bar' → increase formality by 0.10-0.15
    - 'bar/lounge' + 'fancy dress up' = formality_level 0.75-0.80, occasion_type party
    - cold night at indoor venue = temperature_context cold, setting indoor

    Return only the JSON object with no markdown, no code fences, no extra text."""
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
    )
    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()
    result = json.loads(raw)
    return result


def _real_explain_outfit(items: List[Dict], occasion: Dict) -> str:
    """
    Generate a human-readable explanation for why this outfit was chosen.
    Keeps the prompt concise to minimise token cost.
    """
    from openai import OpenAI

    client = OpenAI(api_key=get_settings().openai_api_key)

    # Summarise items for the prompt
    item_summaries = ", ".join(
        f"{i.get('color', '')} {i.get('category', 'item')} (formality {i.get('formality_score', 0.5):.1f})"
        for i in items
    )
    prompt = f"""
            You are a professional stylist. Explain in 2-3 sentences why this outfit works for the occasion.
            
            Occasion: {occasion.get('occasion_type')} ({occasion.get('setting')})
            Formality level: {occasion.get('formality_level')}
            Items: {item_summaries}
            
            Be specific, warm, and concise. No bullet points.
            """
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
    )
    return response.choices[0].message.content.strip()


# ── Public interface ──────────────────────────────────────────────────────────

def parse_occasion(raw_text: str) -> Dict[str, Any]:
    """
    Convert free-text event description into a structured occasion dict.
    Returns keys: occasion_type, formality_level, temperature_context, setting.
    """
    settings = get_settings()
    if settings.use_mock_ai:
        return _mock_parse_occasion(raw_text)
    return _real_parse_occasion(raw_text)


def explain_outfit(items: List[Dict], occasion: Dict) -> str:
    """
    Generate a natural-language explanation for the recommended outfit.
    Args:
        items:    List of clothing item dicts (with color, category, formality_score).
        occasion: Structured occasion dict from parse_occasion().
    """
    settings = get_settings()
    if settings.use_mock_ai:
        return _mock_explain_outfit(items)
    return _real_explain_outfit(items, occasion)


# ── Face Detection ──────────────────────────────────────────────────────────
def detect_face_shape(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """
    Detect face shape from an image using GPT-4o Vision.
    Returns {"face_shape": str|None, "confidence": str, "reason": str}
    """
    settings = get_settings()
    if settings.use_mock_ai:
        return {"face_shape": None, "confidence": "low", "reason": "Mock mode — face detection skipped"}
    try:
        import base64, json
        from openai import OpenAI
        client = OpenAI(api_key=get_settings().openai_api_key)
        b64 = base64.b64encode(image_bytes).decode()
        resp = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=150,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{b64}"}
                    },
                    {
                        "type": "text",
                        "text": """Analyse the face in this photo and identify the face shape.
                        Return ONLY valid JSON, no markdown, no code fences:
                        {
                          "face_shape": "one of: oval, round, square, heart, diamond, oblong",
                          "confidence": "high or medium or low",
                          "reason": "one concise sentence"
                        }
                        If no face is clearly visible return:
                        {"face_shape": null, "confidence": "low", "reason": "No face detected"}"""
                    }
                ]
            }]
        )
        raw = resp.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())
    except Exception as e:
        return {"face_shape": None, "confidence": "low", "reason": f"Detection failed: {str(e)}"}

# ── Clothing descriptor definitions ──────────────────────────────────────────

CATEGORY_DESCRIPTORS = {
    # ── Tops ──────────────────────────────────────────────────────────────────
    "tops": {
        "fabric_type":   ["cotton", "polyester", "nylon", "spandex", "rayon", "linen", "denim",
                          "satin", "silk", "chiffon", "mesh", "lace", "knit", "wool"],
        "neckline":      ["crew", "round", "V-neck", "square", "scoop", "sweetheart", "off-shoulder",
                          "halter", "high neck", "turtleneck", "collar", "cowl", "asymmetrical"],
        "sleeve_length": ["sleeveless", "cap", "short", "3/4", "long"],
        "sleeve_style":  ["puff", "bishop", "balloon", "bell", "raglan", "batwing", "cold shoulder", "flutter"],
        "fit":           ["slim", "regular", "relaxed", "loose", "oversized", "bodycon",
                          "tailored", "A-line", "fit & flare", "wrap"],
        "length":        ["crop", "regular", "longline"],
        "closure":       ["pullover", "button-front", "zip-up", "wrap", "open front"],
        "hemline":       ["straight", "curved", "asymmetrical", "high-low", "peplum", "ruffle hem"],
        "strap_type":    ["strapless", "spaghetti", "wide", "adjustable", "racerback", "cross-back", "halter"],
        "back_style":    ["open back", "low back", "keyhole", "strappy", "tie-back", "zipper back"],
        "detailing":     ["ruffles", "pleats", "ruched", "smocked", "tiered", "draped",
                          "cut-out", "slit", "bow", "knot", "lace-up", "fringe", "embroidery"],
        "elasticity":    ["non-stretch", "slight stretch", "medium stretch", "high stretch"],
        "sheer":         ["opaque", "semi-sheer", "sheer"],
        "pattern":       ["solid", "floral", "striped", "graphic", "abstract", "tie-dye", "plaid", "animal print"],
    },
    # ── Dresses ───────────────────────────────────────────────────────────────
    "dresses": {
        "fabric_type":   ["cotton", "polyester", "nylon", "spandex", "rayon", "linen", "denim",
                          "satin", "silk", "chiffon", "mesh", "lace", "knit", "wool"],
        "neckline":      ["crew", "round", "V-neck", "square", "scoop", "sweetheart", "off-shoulder",
                          "halter", "high neck", "turtleneck", "collar", "cowl", "asymmetrical"],
        "sleeve_length": ["sleeveless", "cap", "short", "3/4", "long"],
        "sleeve_style":  ["puff", "bishop", "balloon", "bell", "raglan", "batwing", "cold shoulder", "flutter"],
        "fit":           ["slim", "regular", "relaxed", "loose", "oversized", "bodycon",
                          "tailored", "A-line", "fit & flare", "wrap"],
        "length":        ["crop", "regular", "longline", "mini", "midi", "maxi"],
        "closure":       ["pullover", "button-front", "zip-up", "wrap", "open front"],
        "hemline":       ["straight", "curved", "asymmetrical", "high-low", "peplum", "ruffle hem"],
        "strap_type":    ["strapless", "spaghetti", "wide", "adjustable", "racerback", "cross-back", "halter"],
        "back_style":    ["open back", "low back", "keyhole", "strappy", "tie-back", "zipper back"],
        "detailing":     ["ruffles", "pleats", "ruched", "smocked", "tiered", "draped",
                          "cut-out", "slit", "bow", "knot", "lace-up", "fringe", "embroidery"],
        "elasticity":    ["non-stretch", "slight stretch", "medium stretch", "high stretch"],
        "sheer":         ["opaque", "semi-sheer", "sheer"],
        "pattern":       ["solid", "floral", "striped", "graphic", "abstract", "tie-dye", "plaid", "animal print"],
    },
    # ── Outerwear ─────────────────────────────────────────────────────────────
    "outerwear": {
        "fabric_type":        ["cotton", "polyester", "nylon", "spandex", "rayon", "linen", "denim",
                               "satin", "silk", "chiffon", "mesh", "lace", "knit", "wool"],
        "neckline":           ["crew", "round", "V-neck", "square", "scoop", "sweetheart", "off-shoulder",
                               "halter", "high neck", "turtleneck", "collar", "cowl", "asymmetrical"],
        "sleeve_length":      ["sleeveless", "cap", "short", "3/4", "long"],
        "sleeve_style":       ["puff", "bishop", "balloon", "bell", "raglan", "batwing", "cold shoulder", "flutter"],
        "fit":                ["slim", "regular", "relaxed", "loose", "oversized", "bodycon",
                               "tailored", "A-line", "fit & flare", "wrap"],
        "length":             ["crop", "regular", "longline"],
        "closure":            ["pullover", "button-front", "zip-up", "wrap", "open front"],
        "hemline":            ["straight", "curved", "asymmetrical", "high-low", "peplum", "ruffle hem"],
        "back_style":         ["open back", "low back", "keyhole", "strappy", "tie-back", "zipper back"],
        "detailing":          ["ruffles", "pleats", "ruched", "smocked", "tiered", "draped",
                               "cut-out", "slit", "bow", "knot", "lace-up", "fringe", "embroidery"],
        "elasticity":         ["non-stretch", "slight stretch", "medium stretch", "high stretch"],
        "sheer":              ["opaque", "semi-sheer", "sheer"],
        "pattern":            ["solid", "floral", "striped", "graphic", "abstract", "tie-dye", "plaid", "animal print"],
        "insulation":         ["lightweight", "midweight", "heavyweight", "insulated", "down-filled"],
        "weather_resistance": ["water-resistant", "waterproof", "windproof"],
    },
    # ── Bottoms ───────────────────────────────────────────────────────────────
    "bottoms": {
        "fabric_type":     ["denim", "cotton", "polyester", "linen", "knit", "leather"],
        "waist_position":  ["high", "mid", "low", "drop", "empire"],
        "waist_structure": ["elastic", "drawstring", "belted", "paperbag", "corset"],
        "fit":             ["slim", "straight", "relaxed", "loose", "wide-leg", "flared"],
        "leg_opening":     ["skinny", "straight", "wide", "flare", "bootcut", "tapered", "barrel"],
        "length":          ["shorts", "mini", "midi", "maxi", "capri", "ankle", "full-length"],
        "distressing":     ["clean", "distressed", "ripped", "frayed", "washed"],
        "elasticity":      ["non-stretch", "slight stretch", "medium stretch", "high stretch"],
        "sheer":           ["opaque", "semi-sheer"],
        "pattern":         ["solid", "plaid", "striped", "floral"],
    },
    # ── Shoes ─────────────────────────────────────────────────────────────────
    "shoes": {
        "shoe_type":   ["heels", "sneakers", "sandals", "boots", "flats", "loafers",
                        "pumps", "mules", "platforms", "mary janes"],
        "toe_shape":   ["round", "pointed", "square", "open-toe", "peep-toe"],
        "heel_height": ["flat", "low", "mid", "high", "platform"],
        "heel_type":   ["stiletto", "block", "wedge", "kitten", "cone", "spool", "chunky", "sculptural"],
        "closure":     ["slip-on", "lace-up", "buckle", "zip", "velcro", "strappy"],
        "fit":         ["regular", "wide", "narrow"],
        "material":    ["leather", "suede", "canvas", "synthetic", "fabric"],
        "pattern":     ["solid", "animal print", "textured", "colorblock"],
    },
    # ── Accessories ───────────────────────────────────────────────────────────
    "accessories": {
        "accessory_type": ["handbag", "tote", "clutch", "backpack", "crossbody", "belt",
                           "scarf", "hat", "sunglasses", "jewelry", "watch"],
        "size":           ["mini", "small", "medium", "large", "oversized"],
        "material":       ["leather", "fabric", "straw", "metal", "synthetic"],
        "style":          ["structured", "slouchy", "minimalist", "embellished", "logo"],
        "closure":        ["zipper", "magnetic", "snap", "drawstring"],
        "strap_type":     ["top handle", "crossbody", "shoulder", "chain"],
    },
}

COMMON_DESCRIPTORS: dict = {}  # all attributes are now per-category


def describe_clothing(image_bytes: bytes, category: str, mime_type: str = "image/jpeg") -> dict:
    """
    Use GPT-4o Vision to identify clothing descriptors from an image.
    Returns a dict of descriptor key → detected value.
    e.g. {"silhouette": "A-line", "neckline": "V-neck", "back": "backless", "fit": "fitted"}
    """
    settings = get_settings()
    if settings.use_mock_ai:
        return _mock_describe_clothing(category)

    cat = category.lower().rstrip("s")  # normalise e.g. "dresses" → "dress"
    # Find matching key
    cat_key = next((k for k in CATEGORY_DESCRIPTORS if k.startswith(cat) or cat in k), None)
    cat_descriptors = CATEGORY_DESCRIPTORS.get(cat_key or "", {})
    all_descriptors = {**cat_descriptors, **COMMON_DESCRIPTORS}

    if not all_descriptors:
        return {}

    # Build descriptor options string for prompt
    options_text = "\n".join(
        f'- "{key}": one of {values}'
        for key, values in all_descriptors.items()
    )

    try:
        import base64, json
        from openai import OpenAI
        client = OpenAI(api_key=get_settings().openai_api_key)
        b64 = base64.b64encode(image_bytes).decode()

        resp = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=300,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{b64}"}
                    },
                    {
                        "type": "text",
                        "text": f"""Analyse this {category} clothing item and identify its descriptors.
                        Return ONLY valid JSON, no markdown, no code fences.
                        Choose the best matching value for each key from the options given.
                        If a descriptor is not clearly visible or applicable, omit it.
                        
                        Descriptor options:
                        {options_text}
                        
                        Return format example:
                        {{"silhouette": "A-line", "neckline": "V-neck", "back": "backless"}}"""
                    }
                ]
            }]
        )

        raw = resp.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw.strip())

    except Exception as e:
        return {}


def _mock_describe_clothing(category: str) -> dict:
    """Deterministic mock descriptors for local dev."""
    cat = category.lower()
    if "dress" in cat:
        return {
            "fabric_type": "polyester", "neckline": "V-neck", "sleeve_length": "sleeveless",
            "fit": "A-line", "length": "midi",
            "hemline": "straight", "strap_type": "spaghetti",
            "back_style": "zipper back", "detailing": "none",
            "elasticity": "medium stretch", "sheer": "opaque", "pattern": "solid",
        }
    if "top" in cat:
        return {
            "fabric_type": "cotton", "neckline": "crew", "sleeve_length": "short",
            "sleeve_style": "raglan", "fit": "regular", "length": "regular",
            "closure": "pullover", "hemline": "straight",
            "elasticity": "slight stretch", "sheer": "opaque", "pattern": "solid",
        }
    if "bottom" in cat:
        return {
            "fabric_type": "denim", "waist_position": "high", "waist_structure": "belted",
            "fit": "straight", "leg_opening": "straight",
            "length": "full-length", "distressing": "clean",
            "elasticity": "slight stretch", "sheer": "opaque", "pattern": "solid",
        }
    if "outer" in cat:
        return {
            "fabric_type": "wool", "neckline": "collar", "sleeve_length": "long",
            "sleeve_style": "raglan", "fit": "tailored", "length": "longline",
            "closure": "button-front", "hemline": "straight",
            "pattern": "solid", "insulation": "midweight",
        }
    if "shoe" in cat:
        return {
            "shoe_type": "sneakers", "toe_shape": "round",
            "heel_height": "flat", "closure": "lace-up",
            "fit": "regular", "material": "canvas", "pattern": "solid",
        }
    return {"fabric_type": "cotton", "fit": "regular"}
