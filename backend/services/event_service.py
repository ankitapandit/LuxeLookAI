"""
services/event_service.py — Event creation and retrieval
=========================================================
Supports mock mode (in-memory) and real mode (Supabase).
Controlled by USE_MOCK_AUTH in .env.
"""

from __future__ import annotations
import logging
import uuid
import json
from typing import Dict, Any, List

from config import get_settings
from ml.llm import parse_occasion

logger = logging.getLogger(__name__)
TABLE = "events"


def _join_list(values: Any) -> str:
    if isinstance(values, list):
        cleaned = [str(value).strip() for value in values if str(value).strip()]
        return ", ".join(cleaned)
    if isinstance(values, str):
        return values.strip()
    return ""


def _humanize_event_summary(raw_text: str, raw_text_json: Dict[str, Any] | None) -> str:
    structured = raw_text_json or {}
    if not structured:
        return (raw_text or "").strip() or "Event styling request"

    dress_code = ", ".join(filter(None, [
        _join_list(structured.get("dressCode")),
        str(structured.get("dressCodeOther") or "").strip(),
    ])).strip(", ")
    location = str(structured.get("location") or "").strip()
    venue = ", ".join(filter(None, [
        _join_list(structured.get("venue")),
        str(structured.get("venueOther") or "").strip(),
    ])).strip(", ")
    time_of_day = str(structured.get("timeOfDay") or "").strip()
    weather = str(structured.get("weather") or "").strip()
    purpose = str(structured.get("purposeOther") or structured.get("purpose") or "").strip()
    comfort = str(structured.get("comfortOrFashion") or "").strip()
    duration = str(structured.get("duration") or "").strip()
    audience = str(structured.get("audience") or "").strip()
    mood = str(structured.get("styleMoodOther") or structured.get("styleMood") or "").strip()
    notes = str(structured.get("notes") or "").strip()

    opening = " ".join(part for part in [dress_code, location.lower() if location else "", venue.lower() if venue else ""] if part).strip()
    if purpose:
        opening = f"{opening} {purpose.lower()}".strip()

    detail_parts = [weather.lower() if weather else "", time_of_day.lower() if time_of_day else ""]
    if comfort:
        detail_parts.append(f"{comfort.lower()}-first")
    if duration:
        detail_parts.append(duration.lower())
    if mood:
        detail_parts.append(mood.lower())

    sentence = " ".join(part for part in [opening, "with " + audience.lower() if audience else "", "for " + " and ".join(p for p in detail_parts if p) if any(detail_parts) else ""] if part).strip()
    sentence = " ".join(sentence.split())
    if notes:
        sentence = f"{sentence}. {notes}".strip()
    if not sentence:
        sentence = (raw_text or "").strip() or "Event styling request"
    return sentence[:1].upper() + sentence[1:]


def _compose_event_prompt(summary: str, raw_text_json: Dict[str, Any] | None) -> str:
    structured = raw_text_json or {}
    if not structured:
        return summary

    lines = []
    mapping = [
        ("Dress Code", ", ".join(filter(None, [_join_list(structured.get("dressCode")), str(structured.get("dressCodeOther") or "").strip()]))),
        ("Location", structured.get("location")),
        ("Venue", ", ".join(filter(None, [_join_list(structured.get("venue")), str(structured.get("venueOther") or "").strip()]))),
        ("Time of Day", structured.get("timeOfDay")),
        ("Weather & Climate", structured.get("weather")),
        ("Purpose & Event Type", structured.get("purposeOther") or structured.get("purpose")),
        ("Style & Mood", structured.get("styleMoodOther") or structured.get("styleMood")),
        ("Comfort or Fashion First", structured.get("comfortOrFashion")),
        ("Duration", structured.get("duration")),
        ("Audience / Company", structured.get("audience")),
        ("Notes", structured.get("notes")),
    ]
    for label, value in mapping:
        text = _join_list(value) if isinstance(value, list) else str(value or "").strip()
        if text:
            lines.append(f"- {label}: {text}")

    return "\n".join([
        f"Event summary: {summary}",
        "Structured event details:",
        *lines,
        f"JSON payload: {json.dumps(structured)}",
    ])


def _enrich_event_tokens(structured: Dict[str, Any], summary: str, raw_text_json: Dict[str, Any] | None) -> None:
    """
    Inject tokens from every EventBriefValues field into event_tokens so the
    recommender's scoring gates can act on the full structured brief.

    Token vocabulary = lowercased option values from EventBriefEditor dropdowns:
      venue       → "concert", "theatre", "stadium", "park", "rooftop", …
      location    → "indoor", "outdoor", "both"
      timeOfDay   → "daytime", "evening", "nighttime"
      comfortOrFashion → "comfort", "balanced", "fashion"
      duration    → "under 2 hours", "2-4 hours", "half day", "all day", "day to night"
      audience    → "solo", "date", "friends", "family", "colleagues", "clients"
      styleMood   → "minimalist", "romantic", "bold", "elegant", "classic", "sexy", "street smart"
      purpose     → "date night", "party", "dinner", "vacation", "work event", …
      dressCode   → "casual", "smart casual", "business casual", "cocktail", "black tie"
      notes       → activity words: "walking", "dancing", "standing", "grass", …
      water-body synonyms → "beach", "pool", "resort", "swim" (canonical gate tokens)
    """
    form = raw_text_json or {}
    existing: List[str] = list(structured.get("event_tokens") or [])

    def _add(token: str) -> None:
        t = token.lower().strip()
        if t and t != "other" and t not in existing:
            existing.append(t)

    # ── 1. Multi-select fields: add each selected value directly ───────────
    # venue (array of option strings)
    for v in (form.get("venue") or []):
        _add(str(v))
    # dress code (array)
    for v in (form.get("dressCode") or []):
        _add(str(v))

    # ── 2. Single-select fields: add the chosen value directly ─────────────
    for field in ("location", "timeOfDay", "comfortOrFashion", "duration", "audience", "styleMood", "purpose"):
        val = form.get(field)
        if val:
            _add(str(val))

    # ── 3. "Other" free-text fields: tokenize meaningful words ────────────
    other_fields = ("venueOther", "dressCodeOther", "durationOther", "audienceOther", "styleMoodOther", "purposeOther")
    other_text = " ".join(str(form.get(f) or "") for f in other_fields).lower()

    # ── 4. Notes: extract activity keywords ───────────────────────────────
    notes = str(form.get("notes") or "").lower()
    _NOTES_ACTIVITY_KEYWORDS: Dict[str, str] = {
        "walk": "walking",   "stroll": "walking",
        "danc": "dancing",   "stand": "standing",
        "sit":  "sitting",   "grass": "grass",
        "hike": "hiking",    "run":   "running",
        "drive": "driving",  "swim":  "swim",
    }
    for keyword, token in _NOTES_ACTIVITY_KEYWORDS.items():
        if keyword in notes:
            _add(token)

    # ── 5. Water-body synonyms → canonical beach/pool/resort/swim tokens ──
    # These must match the recommender's _BEACH_TOKENS gate exactly.
    full_scan = f"{summary} {other_text} {notes} {' '.join(str(v) for v in (form.get('venue') or []))}".lower()
    _WATER_SYNONYMS: List[tuple] = [
        ({"ocean", "sea", "seaside", "shore", "coast", "coastal", "waterfront",
          "harbour", "harbor", "marina", "pier", "dock", "lakeside", "riverside",
          "lake", "boat", "yacht", "vessel", "nautical", "sailing"}, "beach"),
        ({"pool", "poolside", "waterpark", "water park", "hot tub", "jacuzzi", "lido"}, "pool"),
        ({"resort", "island retreat", "all-inclusive", "all inclusive"}, "resort"),
        ({"swim", "swimming", "snorkel", "snorkelling", "snorkeling", "diving", "scuba"}, "swim"),
    ]
    for synonyms, token in _WATER_SYNONYMS:
        if token not in existing and any(syn in full_scan for syn in synonyms):
            existing.append(token)

    structured["event_tokens"] = existing


# ── Direct formality override from structured dressCode ───────────────────────
# The user explicitly picked a dress code from a dropdown — trust it over the
# LLM's formality inference from free text.
_DRESS_CODE_FORMALITY: Dict[str, float] = {
    "Casual":           0.20,
    "Smart Casual":     0.45,
    "Business Casual":  0.62,
    "Cocktail":         0.80,
    "Black Tie":        0.95,
    "None":             0.18,
}


def _apply_direct_formality(structured: Dict[str, Any], form: Dict[str, Any]) -> None:
    """Override LLM-parsed formality_level when dressCode is explicitly chosen."""
    codes = [str(c).strip() for c in (form.get("dressCode") or [])
             if str(c).strip() and str(c).strip() not in ("", "Other")]
    if not codes:
        return
    values = [_DRESS_CODE_FORMALITY[c] for c in codes if c in _DRESS_CODE_FORMALITY]
    if values:
        # Multiple dress codes → average them
        structured["formality_level"] = round(sum(values) / len(values), 3)


def _create_event_mock(user_id: str, raw_text: str, raw_text_json: Dict[str, Any] | None = None) -> Dict:
    from utils.mock_db_store import insert
    summary = _humanize_event_summary(raw_text, raw_text_json)
    structured = parse_occasion(_compose_event_prompt(summary, raw_text_json))
    _apply_direct_formality(structured, raw_text_json or {})
    _enrich_event_tokens(structured, summary, raw_text_json)
    row = {
        "id":                  str(uuid.uuid4()),
        "user_id":             user_id,
        "raw_text":            summary,
        "raw_text_json":       raw_text_json or {},
        "occasion_type":       structured.get("occasion_type", "casual"),
        "formality_level":     structured.get("formality_level", 0.5),
        "temperature_context": structured.get("temperature_context", "unknown"),
        "setting":             structured.get("setting", ""),
        "event_tokens":        structured.get("event_tokens", []),
    }
    return insert(TABLE, row)


def _get_event_mock(event_id: str, user_id: str) -> Dict:
    from utils.mock_db_store import select_one
    return _hydrate_event_context(select_one(TABLE, {"id": event_id, "user_id": user_id}))


def _create_event_real(user_id: str, raw_text: str, raw_text_json: Dict[str, Any] | None = None) -> Dict:
    from utils.db import get_supabase
    db = get_supabase()
    summary = _humanize_event_summary(raw_text, raw_text_json)
    structured = parse_occasion(_compose_event_prompt(summary, raw_text_json))
    _apply_direct_formality(structured, raw_text_json or {})
    _enrich_event_tokens(structured, summary, raw_text_json)
    row = {
        "id":                  str(uuid.uuid4()),
        "user_id":             user_id,
        "raw_text":            summary,
        "raw_text_json":       raw_text_json or {},
        "occasion_type":       structured.get("occasion_type", "casual"),
        "formality_level":     structured.get("formality_level", 0.5),
        "temperature_context": structured.get("temperature_context", "unknown"),
        "setting":             structured.get("setting", ""),
        "event_tokens":        structured.get("event_tokens", []),
    }
    result = db.table(TABLE).insert(row).execute()
    return result.data[0]


def _hydrate_event_context(event: Dict[str, Any] | None) -> Dict[str, Any] | None:
    """
    Rebuild transient occasion fields from the stored structured payload so
    recommendation runs benefit from newer parsing/enrichment logic even for
    events created before those heuristics existed.
    """
    if not event:
        return event
    raw_text_json = event.get("raw_text_json") or {}
    if not raw_text_json:
        return event

    summary = _humanize_event_summary(str(event.get("raw_text") or ""), raw_text_json)
    structured = parse_occasion(_compose_event_prompt(summary, raw_text_json))
    # User's explicit dress-code selection always takes priority over LLM inference
    _apply_direct_formality(structured, raw_text_json)
    _enrich_event_tokens(structured, summary, raw_text_json)

    hydrated = dict(event)
    hydrated.update({
        "raw_text": summary,
        "occasion_type": structured.get("occasion_type", event.get("occasion_type", "casual")),
        "formality_level": structured.get("formality_level", event.get("formality_level", 0.5)),
        "temperature_context": structured.get("temperature_context", event.get("temperature_context", "unknown")),
        "setting": structured.get("setting", event.get("setting", "")),
        "event_tokens": structured.get("event_tokens", event.get("event_tokens", [])),
    })
    return hydrated


def _get_event_real(event_id: str, user_id: str) -> Dict:
    from utils.db import get_supabase
    db = get_supabase()
    result = db.table(TABLE).select("*").eq("id", event_id).eq("user_id", user_id).single().execute()
    return _hydrate_event_context(result.data)


def create_event(user_id: str, raw_text: str, raw_text_json: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Parse a structured event description and persist both summary and source JSON."""
    settings = get_settings()
    if settings.use_mock_auth:
        return _create_event_mock(user_id, raw_text, raw_text_json)
    return _create_event_real(user_id, raw_text, raw_text_json)


def get_event(event_id: str, user_id: str) -> Dict[str, Any]:
    """Fetch a single event. user_id guard prevents cross-user access."""
    settings = get_settings()
    if settings.use_mock_auth:
        return _get_event_mock(event_id, user_id)
    return _get_event_real(event_id, user_id)


def get_user_events(user_id: str) -> List[Dict[str, Any]]:
    """Fetch all events for a user, newest first."""
    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import select_all
        events = select_all(TABLE, {"user_id": user_id})
        return sorted(events, key=lambda e: e.get("created_at", ""), reverse=True)
    else:
        from utils.db import get_supabase
        return (
            get_supabase().table(TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
            .data
        )
