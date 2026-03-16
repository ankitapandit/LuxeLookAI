"""
services/event_service.py — Event creation and retrieval
=========================================================
Supports mock mode (in-memory) and real mode (Supabase).
Controlled by USE_MOCK_AUTH in .env.
"""

from __future__ import annotations
import logging
import uuid
from typing import Dict, Any

from config import get_settings
from ml.llm import parse_occasion

logger = logging.getLogger(__name__)
TABLE = "events"


def _create_event_mock(user_id: str, raw_text: str) -> Dict:
    from utils.mock_db_store import insert
    structured = parse_occasion(raw_text)
    row = {
        "id":                  str(uuid.uuid4()),
        "user_id":             user_id,
        "raw_text":            raw_text,
        "occasion_type":       structured.get("occasion_type", "casual"),
        "formality_level":     structured.get("formality_level", 0.5),
        "temperature_context": structured.get("temperature_context", "unknown"),
        "setting":             structured.get("setting", ""),
    }
    return insert(TABLE, row)


def _get_event_mock(event_id: str, user_id: str) -> Dict:
    from utils.mock_db_store import select_one
    return select_one(TABLE, {"id": event_id, "user_id": user_id})


def _create_event_real(user_id: str, raw_text: str) -> Dict:
    from utils.db import get_supabase
    db = get_supabase()
    structured = parse_occasion(raw_text)
    row = {
        "id":                  str(uuid.uuid4()),
        "user_id":             user_id,
        "raw_text":            raw_text,
        "occasion_type":       structured.get("occasion_type", "casual"),
        "formality_level":     structured.get("formality_level", 0.5),
        "temperature_context": structured.get("temperature_context", "unknown"),
        "setting":             structured.get("setting", ""),
    }
    result = db.table(TABLE).insert(row).execute()
    return result.data[0]


def _get_event_real(event_id: str, user_id: str) -> Dict:
    from utils.db import get_supabase
    db = get_supabase()
    result = db.table(TABLE).select("*").eq("id", event_id).eq("user_id", user_id).single().execute()
    return result.data


def create_event(user_id: str, raw_text: str) -> Dict[str, Any]:
    """Parse a free-text event description and persist it."""
    settings = get_settings()
    if settings.use_mock_auth:
        return _create_event_mock(user_id, raw_text)
    return _create_event_real(user_id, raw_text)


def get_event(event_id: str, user_id: str) -> Dict[str, Any]:
    """Fetch a single event. user_id guard prevents cross-user access."""
    settings = get_settings()
    if settings.use_mock_auth:
        return _get_event_mock(event_id, user_id)
    return _get_event_real(event_id, user_id)

