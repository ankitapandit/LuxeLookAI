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
    "The silhouette choice here flatters your body type by drawing the eye to the right proportions. Consistent tones keep the look sharp without effort.",
    "Clean lines and a single pattern keep this look cohesive. The formality lands exactly where this occasion calls for — polished but not overdressed.",
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

    # ── Event tokens — semantic tags for occasion-scoped feedback ─────────
    # Activity tokens (highest discriminative power)
    _ACTIVITY_MAP = {
        "dinner": "dinner", "brunch": "brunch", "lunch": "lunch",
        "breakfast": "breakfast", "interview": "interview", "meeting": "meeting",
        "conference": "conference", "wedding": "wedding", "gala": "gala",
        "cocktail": "cocktail", "party": "party", "birthday": "birthday",
        "celebration": "celebration", "date": "date", "concert": "concert",
        "ceremony": "ceremony", "reception": "reception", "bbq": "bbq",
        "picnic": "picnic", "workout": "workout", "gym": "gym", "hike": "hiking",
        "exhibition": "exhibition", "show": "show",
    }
    # Setting tokens (medium discriminative power)
    _SETTING_MAP = {
        "beach": "beach", "office": "office", "restaurant": "restaurant",
        "museum": "museum", "garden": "garden", "rooftop": "rooftop",
        "bar": "bar", "park": "park", "lounge": "lounge", "gallery": "gallery",
        "hotel": "hotel", "club": "club", "outdoor": "outdoor", "indoor": "indoor",
    }
    # Social / time tokens (lower discriminative power)
    _SOCIAL_MAP = {
        "date": "romantic", "romantic": "romantic", "professional": "professional",
        "friends": "friends", "family": "family", "colleagues": "colleagues",
        "morning": "morning", "afternoon": "afternoon", "evening": "evening",
        "night": "night",
    }

    tokens: List[str] = []
    for kw, tag in {**_ACTIVITY_MAP, **_SETTING_MAP, **_SOCIAL_MAP}.items():
        if kw in text and tag not in tokens:
            tokens.append(tag)

    return {
        "occasion_type":       occasion,
        "formality_level":     formality,
        "setting":             setting,
        "temperature_context": temp,
        "event_tokens":        tokens,
    }


def _mock_explain_outfit(items: List[Dict], user_body_type: str | None = None, score_breakdown: dict | None = None) -> str:
    """Return a mock explanation using v2 score breakdown tags when available."""
    tags = (score_breakdown or {}).get("tags", {})
    color_tag    = tags.get("color_story", "")
    silhouette   = tags.get("silhouette",  "")
    occasion_tag = tags.get("occasion",    "")
    completeness = tags.get("completeness","")

    cat_colors = [f"{i.get('color', '')} {i.get('category', '')}".strip() for i in items if i.get('category')]
    item_line  = ", ".join(cat_colors[:3]) or "wardrobe pieces"

    parts = [f"This outfit — {item_line} — pulls together well."]
    if color_tag:
        parts.append(f"The {color_tag} creates a cohesive feel.")
    if silhouette and "risk" not in silhouette.lower() and "insufficient" not in silhouette.lower():
        parts.append(f"The {silhouette}.")
    if occasion_tag:
        parts.append(f"This reads as {occasion_tag} for the event.")
    if user_body_type:
        parts.append(f"The proportions are well-suited to a {user_body_type} frame.")
    return " ".join(parts)


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
      "temperature_context": "one of: hot, warm, cool, cold",
      "event_tokens": ["3-8 semantic tags drawn from the event description — use activity tokens (dinner/interview/wedding/party/cocktail/brunch/gala/concert/ceremony/bbq/picnic/workout), setting tokens (beach/office/restaurant/museum/garden/rooftop/bar/park/lounge/gallery/hotel/club), social context (romantic/professional/friends/family/colleagues), and time of day (morning/afternoon/evening/night). Activity tokens carry the most weight — always include them when present."]
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


def _real_explain_outfit(
    items: List[Dict],
    occasion: Dict,
    user_body_type: str | None = None,
    coherence_score: float | None = None,
    score_breakdown: dict | None = None,
) -> str:
    """
    Generate a human-readable explanation for why this outfit was chosen.
    When body type is known, the prompt instructs the model to reference silhouette fit.
    When score_breakdown tags are present, they are used to ground the explanation in
    actual scoring signals (v2). Falls back to coherence_score hint for legacy calls.
    """
    from openai import OpenAI

    client = OpenAI(api_key=get_settings().openai_api_key)

    # Summarise items — include descriptor hints when available
    def _item_line(i: Dict) -> str:
        parts = [i.get("color", ""), i.get("category", "item")]
        descriptors = i.get("descriptors") or {}
        if descriptors.get("fit"):      parts.append(f"{descriptors['fit']} fit")
        if descriptors.get("neckline"): parts.append(f"{descriptors['neckline']} neckline")
        if i.get("pattern") and i["pattern"] not in ("none", "solid", ""):
            parts.append(f"{i['pattern']} pattern")
        return " ".join(p for p in parts if p).strip()

    item_lines = " | ".join(_item_line(i) for i in items)

    # Body-type context block
    body_block = ""
    if user_body_type:
        body_block = (
            f"\nUser's body type: {user_body_type}. "
            "Where relevant, briefly mention how the silhouette or fit choice flatters their proportions."
        )

    # Scoring context from v2 breakdown — grounds the explanation in actual reasons
    scoring_context = ""
    if score_breakdown:
        tags = score_breakdown.get("tags", {})
        hints: List[str] = []
        if tags.get("color_story"):
            hints.append(f"Color story: {tags['color_story']}")
        if tags.get("silhouette") and "insufficient" not in tags["silhouette"].lower():
            hints.append(f"Proportion: {tags['silhouette']}")
        if tags.get("occasion"):
            hints.append(f"Occasion fit: {tags['occasion']}")
        if tags.get("completeness"):
            hints.append(f"Look completeness: {tags['completeness']}")
        if tags.get("risk") and tags["risk"] != "no significant risk":
            hints.append(f"Note: {tags['risk']}")
        if hints:
            scoring_context = "\n\nStyling signals (reference these specifically, do not restate them verbatim):\n" + "\n".join(f"• {h}" for h in hints)
    elif coherence_score is not None:
        # Legacy fallback
        if coherence_score >= 0.90:
            scoring_context = "\nThe outfit has excellent pattern harmony — feel free to highlight this."
        elif coherence_score <= 0.55:
            scoring_context = "\nThe outfit mixes patterns — acknowledge the bold choice without being negative."

    prompt = (
        "You are a professional personal stylist. In 2–3 sentences explain why this outfit works "
        "for the occasion. Be warm, specific, and concise. No bullet points. "
        "Speak to the wearer directly (use 'you' / 'your'). "
        "Reference the specific styling signals provided — do not make up generic praise.\n\n"
        f"Occasion: {occasion.get('occasion_type')} — {occasion.get('setting', 'indoor')}\n"
        f"Formality: {occasion.get('formality_level', 0.5):.0%}\n"
        f"Items: {item_lines}"
        f"{body_block}"
        f"{scoring_context}"
    )

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
        max_tokens=120,
    )
    return response.choices[0].message.content.strip()


# ── Public interface ──────────────────────────────────────────────────────────

def parse_occasion(raw_text: str) -> Dict[str, Any]:
    """
    Convert free-text event description into a structured occasion dict.
    Returns keys: occasion_type, formality_level, temperature_context, setting, event_tokens.
    """
    settings = get_settings()
    if settings.use_mock_ai:
        return _mock_parse_occasion(raw_text)
    return _real_parse_occasion(raw_text)


def explain_outfit(
    items: List[Dict],
    occasion: Dict,
    user_body_type: str | None = None,
    coherence_score: float | None = None,
    score_breakdown: dict | None = None,
) -> str:
    """
    Generate a natural-language explanation for the recommended outfit.
    Args:
        items:           List of clothing item dicts (color, category, formality_score, descriptors).
        occasion:        Structured occasion dict from parse_occasion().
        user_body_type:  Optional body type string — enables silhouette-aware explanation copy.
        coherence_score: Optional 0–1 score — legacy hint for pattern harmony (v1).
        score_breakdown: Optional v2 score breakdown dict with tags — used to ground the
                         explanation in actual scoring signals.
    """
    settings = get_settings()
    if settings.use_mock_ai:
        return _mock_explain_outfit(items, user_body_type, score_breakdown)
    return _real_explain_outfit(items, occasion, user_body_type, coherence_score, score_breakdown)


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
    # ── Set (co-ord / two-piece matching sets) ────────────────────────────────
    "set": {
        "fabric_type":   ["cotton", "polyester", "linen", "satin", "silk", "knit",
                          "denim", "jersey", "terry", "tweed"],
        "fit":           ["fitted", "regular", "relaxed", "oversized", "tailored", "wrap"],
        "top_style":     ["crop", "halter", "bandeau", "off-shoulder", "bralette",
                          "blazer", "shirt", "camisole", "waistcoat"],
        "bottom_style":  ["shorts", "mini skirt", "midi skirt", "trousers", "wide-leg trousers",
                          "straight trousers", "skirt", "leggings"],
        "pattern":       ["solid", "floral", "striped", "plaid", "abstract", "animal print",
                          "geometric", "tie-dye"],
        "closure":       ["pullover", "button-front", "zip-up", "wrap", "hook-and-eye"],
        "detailing":     ["ruffles", "pleats", "smocked", "cut-out", "lace trim", "embroidery"],
    },
    # ── Swimwear ──────────────────────────────────────────────────────────────
    "swimwear": {
        "swimwear_type": ["bikini", "one-piece", "tankini", "monokini", "swim dress",
                          "rash guard", "swim shorts", "boardshorts"],
        "top_style":     ["triangle", "bandeau", "underwire", "halter", "sports bra",
                          "crop", "balconette"],
        "coverage":      ["minimal", "moderate", "full"],
        "neckline":      ["halter", "bandeau", "strapless", "V-neck", "square", "scoop",
                          "off-shoulder", "high-neck"],
        "fabric_type":   ["polyester", "nylon", "spandex", "lycra", "recycled nylon"],
        "pattern":       ["solid", "floral", "animal print", "striped", "tropical",
                          "geometric", "color-block"],
        "closure":       ["pull-on", "tie-side", "buckle", "underwired"],
    },
    # ── Loungewear ────────────────────────────────────────────────────────────
    "loungewear": {
        "loungewear_type": ["hoodie", "sweatshirt", "sweatpants", "joggers", "pajama set",
                            "robe", "shorts set", "tank set", "matching set", "onesie"],
        "fabric_type":     ["cotton", "fleece", "modal", "silk", "satin", "jersey", "terry",
                            "bamboo", "waffle-knit"],
        "fit":             ["oversized", "relaxed", "fitted", "slim", "regular"],
        "closure":         ["pullover", "zip-up", "button-front", "open-front"],
        "length":          ["cropped", "regular", "longline"],
        "pattern":         ["solid", "plaid", "striped", "graphic", "tie-dye", "floral"],
        "detailing":       ["ribbed", "brushed", "waffle texture", "sherpa lined", "drawstring",
                            "kangaroo pocket", "thumbhole"],
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
    # Fetch descriptor vocabulary (DB-backed in real mode, hardcoded in mock)
    from services.taxonomy import get_descriptors
    _descriptors = get_descriptors()
    cat_key = next((k for k in _descriptors if k.startswith(cat) or cat in k), None)
    cat_descriptors = _descriptors.get(cat_key or "", {})
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
