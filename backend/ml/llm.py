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
from typing import Dict, Any, List, Optional

from config import get_settings
from utils.color_utils import normalize_color as _nc

logger = logging.getLogger(__name__)

_CONFIDENCE_VALUES = {"high", "medium", "low"}


def _strip_json_fence(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


def _normalize_trait(
    trait: Any,
    allowed_values: Optional[set[str]] = None,
    default_reason: str = "Trait not detected",
) -> Dict[str, Any]:
    if not isinstance(trait, dict):
        return {"value": None, "confidence": "low", "reason": default_reason}

    value = trait.get("value")
    if isinstance(value, str):
        value = value.strip().lower() or None
    else:
        value = None

    if allowed_values is not None and value not in allowed_values:
        value = None

    confidence = str(trait.get("confidence") or "low").strip().lower()
    if confidence not in _CONFIDENCE_VALUES:
        confidence = "low"

    reason = str(trait.get("reason") or default_reason).strip()
    return {
        "value": value,
        "confidence": confidence,
        "reason": reason or default_reason,
    }


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


_MOCK_VERDICTS = [
    "Polished with a pop. The color combo is doing the most in the best way — structured, sharp, and totally event-ready.",
    "Clean slate, big impact. The tonal palette lets the silhouette speak. Minimal effort, maximum elegance.",
    "Main character energy, unlocked. Every piece earns its place here — nothing extra, nothing missing.",
    "This look hits different. The balance between bold and restrained is exactly where it needs to be for this occasion.",
    "Effortless but make it fashion. The proportions are giving, the color story is coherent, and it reads confident.",
]


def _mock_generate_stylist_verdict(vibe: list, fit_check: str, color_story: str) -> str:
    """Return a deterministic mock stylist verdict seeded by card context."""
    idx = hash(f"{vibe}{fit_check}{color_story}") % len(_MOCK_VERDICTS)
    return _MOCK_VERDICTS[idx]


def _mock_explain_outfit(items: List[Dict], user_body_type: str | None = None, score_breakdown: dict | None = None) -> str:
    """Return a mock explanation using v2 score breakdown tags when available."""
    tags = (score_breakdown or {}).get("tags", {})
    color_tag    = tags.get("color_story", "")
    silhouette   = tags.get("silhouette",  "")
    occasion_tag = tags.get("occasion",    "")
    completeness = tags.get("completeness","")

    cat_colors = [f"{_nc(i.get('color', ''))} {i.get('category', '')}".strip() for i in items if i.get('category')]
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
        parts = [_nc(i.get("color", "")), i.get("category", "item")]
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


def _real_generate_stylist_verdict(
    items: List[Dict],
    occasion: Dict,
    vibe: list,
    color_story: str,
    fit_check: str,
) -> str:
    """
    Call GPT-4o-mini to generate a 2-3 sentence punchy stylist verdict.
    Language target: Zara editorial meets TikTok fashion — specific, confident, quick.
    """
    from openai import OpenAI

    client = OpenAI(api_key=get_settings().openai_api_key)

    cat_colors = [f"{_nc(i.get('color', ''))} {i.get('category', '')}".strip() for i in items if i.get("category")]
    item_line  = ", ".join(cat_colors[:3]) or "wardrobe pieces"

    prompt = (
        "You are a razor-sharp fashion stylist writing quick outfit verdicts for a luxury styling app. "
        "Think Zara editorial copy meets TikTok fashion commentary — punchy, specific, confident. "
        "No generic phrases. No 'this outfit'. No filler. Max 40 words. 2-3 sentences.\n\n"
        f"Items: {item_line}\n"
        f"Occasion: {occasion.get('occasion_type')} ({occasion.get('setting', 'indoor')})\n"
        f"Vibe: {', '.join(vibe)}\n"
        f"Color story: {color_story}\n"
        f"Fit rating: {fit_check}\n\n"
        "Write the verdict. Start with a punchy one-liner (e.g. 'Polished with a pop.' or 'Clean slate, big impact.'). "
        "Then add 1-2 sentences explaining why it works. Be specific about the actual pieces."
    )

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.8,
        max_tokens=70,
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


def generate_stylist_verdict(
    items: List[Dict],
    occasion: Dict,
    vibe: list,
    color_story: str,
    fit_check: str,
) -> str:
    """
    Generate a short 2-3 sentence stylist verdict for an outfit card.

    Args:
        items:        List of clothing item dicts (color, category).
        occasion:     Structured occasion dict from parse_occasion().
        vibe:         Vibe labels already computed for this outfit (e.g. ["Main Character", "Evening Royalty"]).
        color_story:  Human-readable color story label (e.g. "Tonal Moment").
        fit_check:    Fit compatibility label (e.g. "Snatched 🔥").

    Returns:
        2-3 sentence punchy verdict in Zara/TikTok language. Max ~40 words.
    """
    settings = get_settings()
    if settings.use_mock_ai:
        return _mock_generate_stylist_verdict(vibe, fit_check, color_story)
    return _real_generate_stylist_verdict(items, occasion, vibe, color_story, fit_check)


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
        raw = _strip_json_fence(resp.choices[0].message.content)
        parsed = json.loads(raw)
        trait = _normalize_trait(
            {
                "value": parsed.get("face_shape"),
                "confidence": parsed.get("confidence"),
                "reason": parsed.get("reason"),
            },
            {"oval", "round", "square", "heart", "diamond", "oblong"},
            "No face detected",
        )
        return {
            "face_shape": trait["value"],
            "confidence": trait["confidence"],
            "reason": trait["reason"],
        }
    except Exception as e:
        return {"face_shape": None, "confidence": "low", "reason": f"Detection failed: {str(e)}"}


def analyze_profile_traits(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """
    Analyze a profiling photo and infer styling traits.
    Returns normalized JSON keyed by face/body/complexion/hair traits.
    """
    settings = get_settings()
    if settings.use_mock_ai:
        skipped = {"value": None, "confidence": "low", "reason": "Mock mode — AI profiling skipped"}
        return {
            "source": "ai_profile_photo",
            "face_shape": skipped,
            "body_type": skipped,
            "complexion": skipped,
            "hair_texture": skipped,
            "hair_length": skipped,
        }

    try:
        import base64
        from openai import OpenAI

        print(f"[llm] analyze_profile_traits start mime_type={mime_type!r} bytes={len(image_bytes)}")
        client = OpenAI(api_key=settings.openai_api_key)
        b64 = base64.b64encode(image_bytes).decode()
        resp = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=450,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{b64}"},
                    },
                    {
                        "type": "text",
                        "text": """Analyze this AI profiling photo for styling traits.
Return ONLY valid JSON, no markdown, no code fences:
{
  "face_shape": {"value": "oval|round|square|heart|diamond|oblong|null", "confidence": "high|medium|low", "reason": "one concise sentence"},
  "body_type": {"value": "hourglass|pear|apple|rectangle|inverted triangle|null", "confidence": "high|medium|low", "reason": "one concise sentence"},
  "complexion": {"value": "fair|light|medium|olive|tan|deep|null", "confidence": "high|medium|low", "reason": "one concise sentence"},
  "hair_texture": {"value": "straight|wavy|curly|coily|null", "confidence": "high|medium|low", "reason": "one concise sentence"},
  "hair_length": {"value": "short|medium|long|null", "confidence": "high|medium|low", "reason": "one concise sentence"}
}
Rules:
- Use null with low confidence if a trait is not visible enough.
- Body type must describe overall silhouette only when upper/lower body is visible enough.
- Hair texture/length should refer to the visible hair in the photo only.
- Keep reasons brief and grounded in visible cues."""
                    },
                ],
            }],
        )
        print("[llm] analyze_profile_traits OpenAI response received")
        parsed = json.loads(_strip_json_fence(resp.choices[0].message.content))
        print(f"[llm] analyze_profile_traits parsed keys={list(parsed.keys())}")
        return {
            "source": "ai_profile_photo",
            "face_shape": _normalize_trait(
                parsed.get("face_shape"),
                {"oval", "round", "square", "heart", "diamond", "oblong"},
                "Face shape is not clearly visible",
            ),
            "body_type": _normalize_trait(
                parsed.get("body_type"),
                {"hourglass", "pear", "apple", "rectangle", "inverted triangle"},
                "Body shape is not clearly visible",
            ),
            "complexion": _normalize_trait(
                parsed.get("complexion"),
                {"fair", "light", "medium", "olive", "tan", "deep"},
                "Complexion is not clearly visible",
            ),
            "hair_texture": _normalize_trait(
                parsed.get("hair_texture"),
                {"straight", "wavy", "curly", "coily"},
                "Hair texture is not clearly visible",
            ),
            "hair_length": _normalize_trait(
                parsed.get("hair_length"),
                {"short", "medium", "long"},
                "Hair length is not clearly visible",
            ),
        }
    except Exception as e:
        print(f"[llm] analyze_profile_traits failed error={e}")
        failed = {"value": None, "confidence": "low", "reason": f"Analysis failed: {str(e)}"}
        return {
            "source": "ai_profile_photo",
            "face_shape": failed,
            "body_type": failed,
            "complexion": failed,
            "hair_texture": failed,
            "hair_length": failed,
        }

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
    # Full tops + bottoms descriptor combo — both halves are described together.
    "set": {
        # Fabric
        "fabric_type":    ["cotton", "polyester", "linen", "satin", "silk", "knit", "denim",
                           "jersey", "terry", "tweed", "chiffon", "lace", "mesh", "rayon"],
        # Top-half attributes
        "top_style":      ["crop", "halter", "bandeau", "off-shoulder", "bralette", "corset",
                           "blazer", "shirt", "camisole", "waistcoat", "longline"],
        "neckline":       ["crew", "V-neck", "square", "scoop", "sweetheart", "off-shoulder",
                           "halter", "high neck", "turtleneck", "collar", "cowl", "asymmetrical"],
        "sleeve_length":  ["sleeveless", "cap", "short", "3/4", "long"],
        "sleeve_style":   ["puff", "bishop", "balloon", "bell", "raglan", "batwing", "cold shoulder", "flutter"],
        "strap_type":     ["strapless", "spaghetti", "wide", "adjustable", "racerback", "cross-back", "halter"],
        "back_style":     ["open back", "low back", "keyhole", "strappy", "tie-back", "zipper back"],
        # Bottom-half attributes
        "bottom_style":   ["shorts", "mini skirt", "midi skirt", "maxi skirt", "trousers",
                           "wide-leg trousers", "straight trousers", "skirt", "leggings", "flared trousers"],
        "waist_position": ["high", "mid", "low", "empire"],
        "waist_structure":["elastic", "drawstring", "belted", "paperbag", "corset"],
        "leg_opening":    ["skinny", "straight", "wide", "flare", "bootcut", "tapered"],
        # Shared
        "fit":            ["slim", "regular", "relaxed", "oversized", "tailored", "wrap", "bodycon", "A-line"],
        "length":         ["mini", "midi", "maxi", "crop", "regular"],
        "closure":        ["pullover", "button-front", "zip-up", "wrap", "hook-and-eye", "tie"],
        "hemline":        ["straight", "curved", "asymmetrical", "high-low", "ruffle hem"],
        "detailing":      ["ruffles", "pleats", "ruched", "smocked", "tiered", "draped",
                           "cut-out", "slit", "bow", "lace trim", "embroidery"],
        "elasticity":     ["non-stretch", "slight stretch", "medium stretch", "high stretch"],
        "pattern":        ["solid", "floral", "striped", "plaid", "abstract", "animal print",
                           "geometric", "tie-dye", "color-block"],
    },
    # ── Swimwear ──────────────────────────────────────────────────────────────
    # Existing swimwear + bra-type descriptors (top) + underwear-bottom descriptors.
    "swimwear": {
        # Garment type
        "swimwear_type":    ["bikini", "one-piece", "tankini", "monokini", "swim dress",
                             "rash guard", "swim shorts", "boardshorts"],
        # Top-half style
        "top_style":        ["triangle", "bandeau", "underwire", "halter", "sports bra",
                             "crop", "balconette", "longline", "bralette"],
        "neckline":         ["halter", "bandeau", "strapless", "V-neck", "square", "scoop",
                             "off-shoulder", "high-neck"],
        "top_coverage":     ["minimal", "moderate", "full"],
        # Bra-type descriptors (coverage, support, structure, function, fit intent)
        "support":          ["low", "medium", "high"],
        "structure":        ["wired", "wireless", "padded", "unlined"],
        "function":         ["everyday", "sports", "beach", "special occasion"],
        "fit_intent":       ["enhance", "minimize", "natural"],
        # Bottom-half descriptors
        "bottom_rise":      ["low", "mid", "high"],
        "back_coverage":    ["minimal", "partial", "full"],
        "bottom_fit_style": ["thong", "bikini", "boyshort", "brief", "high-waist",
                             "hipster", "cheeky", "string"],
        "bottom_visibility":["seamless", "no-show", "regular"],
        # Fabric & finish
        "fabric_type":      ["polyester", "nylon", "spandex", "lycra", "recycled nylon"],
        "pattern":          ["solid", "floral", "animal print", "striped", "tropical",
                             "geometric", "color-block"],
        "closure":          ["pull-on", "tie-side", "buckle", "underwired"],
    },
    # ── Loungewear ────────────────────────────────────────────────────────────
    # Existing + top-half details (neckline/sleeve/strap) + light bra/waist attributes
    # for cami sets, bralette-top sets, and shorts/jogger bottoms.
    "loungewear": {
        "loungewear_type":  ["hoodie", "sweatshirt", "sweatpants", "joggers", "pajama set",
                             "robe", "shorts set", "tank set", "matching set", "onesie"],
        "fabric_type":      ["cotton", "fleece", "modal", "silk", "satin", "jersey", "terry",
                             "bamboo", "waffle-knit"],
        "fit":              ["oversized", "relaxed", "fitted", "slim", "regular"],
        # Top-half
        "neckline":         ["crew", "V-neck", "scoop", "square", "sweetheart", "halter",
                             "off-shoulder", "turtleneck"],
        "sleeve_length":    ["sleeveless", "cap", "short", "3/4", "long"],
        "strap_type":       ["spaghetti", "wide", "adjustable", "racerback", "strapless"],
        # Bra-relevant (cami/bralette tops in tank sets, pajama sets)
        "support":          ["none", "light", "medium"],
        "structure":        ["wireless", "padded", "unlined", "built-in"],
        "fit_intent":       ["enhance", "minimize", "natural"],
        # Bottom-half
        "waist_structure":  ["elastic", "drawstring", "tie"],
        "bottom_length":    ["shorts", "capri", "ankle", "full-length"],
        # Shared
        "closure":          ["pullover", "zip-up", "button-front", "open-front"],
        "length":           ["cropped", "regular", "longline"],
        "pattern":          ["solid", "plaid", "striped", "graphic", "tie-dye", "floral"],
        "detailing":        ["ribbed", "brushed", "waffle texture", "sherpa lined", "drawstring",
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
