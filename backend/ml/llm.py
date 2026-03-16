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
    """Return a stable mock occasion struct based on text length."""
    idx = len(raw_text) % len(_MOCK_OCCASIONS)
    result = _MOCK_OCCASIONS[idx].copy()
    logger.debug(f"[MOCK] Parsed occasion: {result}")
    return result


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
    prompt  = f"""
You are a fashion-event analyst. Parse the following occasion description and return ONLY a JSON object.

Occasion: "{raw_text}"

Return JSON with these exact keys:
{{
  "occasion_type":       "<one of: formal, casual, business, party, date, outdoor, wedding, other>",
  "formality_level":     <float 0.0 to 1.0>,
  "temperature_context": "<indoor | outdoor | mixed | unknown>",
  "setting":             "<brief venue description e.g. 'restaurant', 'beach', 'office'>"
}}

Return ONLY the JSON. No explanation.
"""
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
    )
    raw = response.choices[0].message.content.strip()
    return json.loads(raw)


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
