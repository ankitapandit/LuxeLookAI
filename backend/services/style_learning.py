"""
services/style_learning.py — Discover swipe logging and preference aggregation
===============================================================================
Raw Discover swipe events are stored separately from the derived preference
summary so we can wait for enough evidence before updating taste signals.

The user-facing rule is:
  - raw interactions are logged immediately
  - preference rows are recomputed after the feed accumulates enough actions
    (roughly every 10 interactions, then again as confidence grows)
"""

from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

from httpx import RemoteProtocolError

from config import get_settings
from services.style_catalog import (
    get_style_lookup_by_id,
    get_style_ids_for_tags,
    normalize_style_tag,
)

logger = logging.getLogger(__name__)

TABLE_INTERACTIONS = "discover_style_interactions"
TABLE_IGNORED_URLS = "discover_ignored_urls"
TABLE_PREFERENCES = "user_style_preferences"
TABLE_DISCOVER_USER_STATE = "discover_user_state"
TABLE_DISCOVER_FAMILY_MEMORY = "discover_family_memory"
DAILY_DISCOVER_LIMIT = 10
POSITIVE_FOLLOWUP_LIMIT = 2
NEGATIVE_VALIDATION_LIMIT = 1
POSITIVE_COOLDOWN_DAYS = 3
NEGATIVE_COOLDOWN_DAYS = 7
DISCOVER_RECENT_FAMILY_WINDOW = 12
DISCOVER_STRICT_REPEAT_GAP = 4
FAMILY_DIMENSION_PRIORITY: Dict[str, int] = {
    "fabric": 0,
    "pattern": 1,
    "color_family": 2,
    "vibe": 3,
    "styling_detail": 4,
    "silhouette": 5,
}
GENERIC_FAMILY_STYLE_KEYS = {
    "clean",
    "polished",
    "modern",
    "casual",
    "classic",
    "elevated",
    "statement",
    "top",
    "bottom",
    "dress",
    "jumpsuit",
    "outerwear",
    "shoes",
    "accessory",
    "jewelry",
    "set",
    "swimwear",
    "loungewear",
    "spring",
    "summer",
    "fall",
    "winter",
    "all",
    "casual_event",
    "smart_casual",
    "business",
    "formal",
    "party",
    "date",
    "travel",
    "resort",
}

ACTION_WEIGHTS: Dict[str, float] = {
    "love": 2.0,
    "like": 1.0,
    "dislike": -2.0,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client_day_key(timezone_name: Optional[str] = None) -> str:
    try:
        target_tz = ZoneInfo(timezone_name) if timezone_name else datetime.now().astimezone().tzinfo or timezone.utc
    except Exception:
        target_tz = timezone.utc
    return datetime.now(target_tz).date().isoformat()


def _canonical_url(url: str) -> str:
    from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

    value = (url or "").strip()
    if not value or value.startswith("data:") or value.startswith("mock://"):
        return value

    parts = urlsplit(value)
    query = urlencode(
        [(key, val) for key, val in parse_qsl(parts.query, keep_blank_values=True)
         if not key.lower().startswith(("utm_", "fbclid", "gclid", "igshid", "ref", "source"))],
        doseq=True,
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))


def _normalize_discover_family_key(value: str) -> str:
    parts = [part.strip().lower() for part in str(value or "").split("|") if part.strip()]
    return "|".join(parts[:2])


def _table_load(table: str, filters: Optional[Dict[str, Any]] = None) -> List[dict]:
    def run() -> List[dict]:
        settings = get_settings()
        if settings.use_mock_auth:
            from utils.mock_db_store import select_all
            return select_all(table, filters)

        from utils.db import get_supabase

        query = get_supabase().table(table).select("*")
        if filters:
            for key, value in filters.items():
                if isinstance(value, list):
                    query = query.in_(key, value)
                else:
                    query = query.eq(key, value)
        result = query.execute()
        return result.data or []

    try:
        return run()
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        return run()


def _table_insert(table: str, row: dict) -> dict:
    def run() -> dict:
        settings = get_settings()
        if settings.use_mock_auth:
            from utils.mock_db_store import insert
            return insert(table, row)

        from utils.db import get_supabase

        result = get_supabase().table(table).insert(row).execute()
        return result.data[0]

    try:
        return run()
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        return run()


def _table_upsert(table: str, row: dict, conflict: str) -> dict:
    def run() -> dict:
        settings = get_settings()
        if settings.use_mock_auth:
            from utils.mock_db_store import insert, select_one, update

            if conflict == "normalized_url":
                existing = select_one(table, {"user_id": row["user_id"], "normalized_url": row["normalized_url"]})
            elif conflict == "user_id,normalized_url":
                existing = select_one(table, {"user_id": row["user_id"], "normalized_url": row["normalized_url"]})
            elif conflict == "user_id,style_id":
                existing = select_one(table, {"user_id": row["user_id"], "style_id": row["style_id"]})
            elif conflict == "user_id":
                existing = select_one(table, {"user_id": row["user_id"]})
            elif conflict == "user_id,family_key":
                existing = select_one(table, {"user_id": row["user_id"], "family_key": row["family_key"]})
            else:
                existing = select_one(table, {"user_id": row["user_id"]})
            if existing:
                return update(table, str(existing["id"]), row, extra_filters={"user_id": row["user_id"]}) or existing
            return insert(table, row)

        from utils.db import get_supabase

        result = get_supabase().table(table).upsert(row, on_conflict=conflict).execute()
        return result.data[0]

    try:
        return run()
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        return run()


def _table_delete(table: str, filters: Dict[str, Any]) -> None:
    def run() -> None:
        settings = get_settings()
        if settings.use_mock_auth:
            from utils.mock_db_store import select_all, delete as mock_delete

            rows = select_all(table, filters)
            for row in rows:
                if row.get("id"):
                    mock_delete(table, str(row["id"]))
            return

        from utils.db import get_supabase

        query = get_supabase().table(table).delete()
        for key, value in filters.items():
            if isinstance(value, list):
                query = query.in_(key, value)
            else:
                query = query.eq(key, value)
        query.execute()

    try:
        return run()
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        return run()


def upsert_ignored_url(user_id: str, payload: Dict[str, Any]) -> dict:
    normalized_url = _canonical_url(payload.get("normalized_url") or payload.get("source_url") or "")
    if not normalized_url:
        return {}
    row = {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{user_id}:{normalized_url}")),
        "user_id": user_id,
        "source_url": payload.get("source_url") or "",
        "normalized_url": normalized_url,
        "image_url": payload.get("image_url") or "",
        "thumbnail_url": payload.get("thumbnail_url"),
        "source_domain": payload.get("source_domain"),
        "search_query": payload.get("search_query"),
        "last_action": payload.get("last_action") or payload.get("action"),
        "reason": payload.get("reason") or "seen",
        "last_seen_at": _now_iso(),
        "created_at": _now_iso(),
    }
    return _table_upsert(TABLE_IGNORED_URLS, row, conflict="user_id,normalized_url")


def _style_row_from_id(style_id: str) -> Optional[dict]:
    lookup = get_style_lookup_by_id()
    if style_id in lookup:
        return lookup[style_id]
    normalized = normalize_style_tag(style_id)
    if normalized in lookup:
        return lookup[normalized]
    return None


def build_discover_family_signature(
    style_ids: Optional[Iterable[str]] = None,
    style_tags: Optional[Iterable[str]] = None,
) -> Tuple[str, str, List[str]]:
    canonical_rows: List[dict] = []
    seen_keys: set[str] = set()

    def add_row(row: Optional[dict]) -> None:
        if not row:
            return
        style_key = str(row.get("style_key") or "").strip().lower()
        if not style_key or style_key in seen_keys:
            return
        seen_keys.add(style_key)
        canonical_rows.append(row)

    normalized_ids = [str(style_id).strip() for style_id in (style_ids or []) if str(style_id).strip()]
    normalized_tags = [normalize_style_tag(str(tag)) for tag in (style_tags or []) if str(tag).strip()]

    for style_id in normalized_ids:
        add_row(_style_row_from_id(style_id))

    if not canonical_rows and normalized_tags:
        resolved_ids, _ = get_style_ids_for_tags(normalized_tags)
        for style_id in resolved_ids:
            add_row(_style_row_from_id(style_id))

    prioritized_rows = [
        row for row in canonical_rows
        if str(row.get("dimension") or "") in FAMILY_DIMENSION_PRIORITY
        and str(row.get("style_key") or "").strip().lower() not in GENERIC_FAMILY_STYLE_KEYS
    ]
    prioritized_rows.sort(
        key=lambda row: (
            FAMILY_DIMENSION_PRIORITY.get(str(row.get("dimension") or ""), 999),
            int(row.get("sort_order") or 0),
            str(row.get("label") or row.get("style_key") or ""),
        )
    )

    selected_rows: List[dict] = []
    used_dimensions: set[str] = set()
    for row in prioritized_rows:
        dimension = str(row.get("dimension") or "")
        if dimension in used_dimensions:
            continue
        selected_rows.append(row)
        used_dimensions.add(dimension)
        if len(selected_rows) >= 2:
            break

    if not selected_rows:
        fallback_rows = [
            row for row in canonical_rows
            if str(row.get("style_key") or "").strip().lower() not in GENERIC_FAMILY_STYLE_KEYS
        ]
        selected_rows = fallback_rows[:2]
    if selected_rows:
        family_keys = [str(row.get("style_key") or "").strip().lower() for row in selected_rows if str(row.get("style_key") or "").strip()]
        family_labels = [str(row.get("label") or row.get("style_key") or "").strip() for row in selected_rows if str(row.get("label") or row.get("style_key") or "").strip()]
        if family_keys and family_labels:
            return "|".join(family_keys), " ".join(family_labels), family_labels

    fallback_tokens = sorted({
        token for token in normalized_tags
        if token and token not in GENERIC_FAMILY_STYLE_KEYS
    })[:2]
    fallback_labels = [token.replace("_", " ").title() for token in fallback_tokens]
    if fallback_tokens and fallback_labels:
        return "|".join(fallback_tokens), " ".join(fallback_labels), fallback_labels

    generic_fallback_tokens = sorted({token for token in normalized_tags if token})[:2]
    generic_fallback_labels = [token.replace("_", " ").title() for token in generic_fallback_tokens]
    if generic_fallback_tokens and generic_fallback_labels:
        return "|".join(generic_fallback_tokens), " ".join(generic_fallback_labels), generic_fallback_labels

    return "", "", []


def load_discover_family_memory_map(user_id: str) -> Dict[str, dict]:
    rows = _table_load(TABLE_DISCOVER_FAMILY_MEMORY, {"user_id": user_id})
    memory: Dict[str, dict] = {}
    for row in rows:
        family_key = _normalize_discover_family_key(str(row.get("family_key") or ""))
        if family_key:
            existing = memory.get(family_key)
            existing_updated = _parse_iso_datetime(existing.get("updated_at")) if existing else None
            row_updated = _parse_iso_datetime(row.get("updated_at"))
            if existing is None or (row_updated and (existing_updated is None or row_updated >= existing_updated)):
                normalized_row = dict(row)
                normalized_row["family_key"] = family_key
                normalized_row["family_label"] = (
                    str(row.get("family_label") or "").strip()
                    or family_key.replace("|", " ").replace("_", " ").title()
                )
                memory[family_key] = normalized_row
    return memory


def touch_discover_user_state(user_id: str, timezone_name: Optional[str] = None) -> dict:
    day_key = _client_day_key(timezone_name)
    existing_rows = _table_load(TABLE_DISCOVER_USER_STATE, {"user_id": user_id})
    existing = existing_rows[0] if existing_rows else {}
    active_day_number = int(existing.get("active_day_number") or 0)
    if existing.get("last_active_day_key") != day_key:
        active_day_number += 1

    row = {
        "id": str(existing.get("id") or uuid.uuid5(uuid.NAMESPACE_URL, f"discover-user-state:{user_id}")),
        "user_id": user_id,
        "last_active_day_key": day_key,
        "active_day_number": max(1, active_day_number),
        "last_active_at": _now_iso(),
        "recent_family_keys": existing.get("recent_family_keys") or [],
        "created_at": existing.get("created_at") or _now_iso(),
        "updated_at": _now_iso(),
    }
    return _table_upsert(TABLE_DISCOVER_USER_STATE, row, conflict="user_id")


def get_recent_discover_family_keys(user_state: Optional[dict]) -> List[str]:
    if not user_state:
        return []
    values = user_state.get("recent_family_keys") or []
    recent: List[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = _normalize_discover_family_key(str(value or ""))
        if cleaned and cleaned not in seen:
            recent.append(cleaned)
            seen.add(cleaned)
    return recent


def record_recent_discover_families(user_state: dict, served_family_keys: List[str]) -> dict:
    existing_recent = get_recent_discover_family_keys(user_state)
    new_recent = list(existing_recent)
    for family_key in served_family_keys:
        cleaned = _normalize_discover_family_key(str(family_key or ""))
        if not cleaned:
            continue
        if cleaned in new_recent:
            new_recent.remove(cleaned)
        new_recent.insert(0, cleaned)
    row = dict(user_state)
    row["recent_family_keys"] = new_recent[:DISCOVER_RECENT_FAMILY_WINDOW]
    row["updated_at"] = _now_iso()
    return _table_upsert(TABLE_DISCOVER_USER_STATE, row, conflict="user_id")


def should_suppress_discover_family(memory: Optional[dict], active_day_number: int) -> bool:
    if not memory:
        return False
    cooldown_until = int(memory.get("cooldown_until_active_day") or 0)
    return cooldown_until > 0 and active_day_number < cooldown_until


def can_reinforce_discover_family(memory: Optional[dict], active_day_number: int) -> bool:
    if not memory:
        return False
    positive_seed_day = int(memory.get("positive_seed_active_day") or 0)
    positive_followups_served = int(memory.get("positive_followups_served") or 0)
    if positive_seed_day == active_day_number and positive_followups_served < POSITIVE_FOLLOWUP_LIMIT:
        return True

    negative_seed_day = int(memory.get("negative_seed_active_day") or 0)
    negative_followups_served = int(memory.get("negative_followups_served") or 0)
    return negative_seed_day == active_day_number and negative_followups_served < NEGATIVE_VALIDATION_LIMIT


def _reset_family_daily_counters(memory: dict, day_key: str, active_day_number: int) -> dict:
    if memory.get("last_shown_day_key") == day_key:
        return memory
    reset = dict(memory)
    reset["shown_count_today"] = 0
    reset["last_shown_day_key"] = day_key
    reset["last_shown_active_day"] = active_day_number
    return reset


def mark_discover_family_served(
    user_id: str,
    family_key: str,
    family_label: str,
    active_day_number: int,
    day_key: str,
) -> dict:
    family_key = _normalize_discover_family_key(family_key)
    family_label = (
        str(family_label or "").strip()
        or family_key.replace("|", " ").replace("_", " ").title()
    )
    existing = load_discover_family_memory_map(user_id).get(family_key, {})
    memory = _reset_family_daily_counters(existing, day_key, active_day_number)
    shown_count_today = int(memory.get("shown_count_today") or 0) + 1

    positive_seed_day = int(memory.get("positive_seed_active_day") or 0)
    positive_followups_served = int(memory.get("positive_followups_served") or 0)
    negative_seed_day = int(memory.get("negative_seed_active_day") or 0)
    negative_followups_served = int(memory.get("negative_followups_served") or 0)
    cooldown_until_active_day = int(memory.get("cooldown_until_active_day") or 0)

    if positive_seed_day == active_day_number:
        positive_followups_served += 1
        if positive_followups_served >= POSITIVE_FOLLOWUP_LIMIT:
            cooldown_until_active_day = max(cooldown_until_active_day, active_day_number + POSITIVE_COOLDOWN_DAYS)

    if negative_seed_day == active_day_number:
        negative_followups_served += 1
        if negative_followups_served >= NEGATIVE_VALIDATION_LIMIT:
            cooldown_until_active_day = max(cooldown_until_active_day, active_day_number + NEGATIVE_COOLDOWN_DAYS)

    row = {
        "id": str(memory.get("id") or uuid.uuid5(uuid.NAMESPACE_URL, f"{user_id}:{family_key}")),
        "user_id": user_id,
        "family_key": family_key,
        "family_label": family_label or memory.get("family_label") or family_key.replace("|", " ").replace("_", " ").title(),
        "shown_count_today": shown_count_today,
        "last_shown_at": _now_iso(),
        "last_shown_day_key": day_key,
        "last_shown_active_day": active_day_number,
        "last_positive_at": memory.get("last_positive_at"),
        "last_negative_at": memory.get("last_negative_at"),
        "positive_seed_active_day": positive_seed_day,
        "positive_followups_served": positive_followups_served,
        "negative_seed_active_day": negative_seed_day,
        "negative_followups_served": negative_followups_served,
        "cooldown_until_active_day": cooldown_until_active_day,
        "last_discover_active_at": _now_iso(),
        "created_at": memory.get("created_at") or _now_iso(),
        "updated_at": _now_iso(),
    }
    return _table_upsert(TABLE_DISCOVER_FAMILY_MEMORY, row, conflict="user_id,family_key")


def mark_discover_family_interaction(
    user_id: str,
    family_key: str,
    family_label: str,
    action: str,
    active_day_number: int,
    day_key: str,
) -> dict:
    family_key = _normalize_discover_family_key(family_key)
    family_label = (
        str(family_label or "").strip()
        or family_key.replace("|", " ").replace("_", " ").title()
    )
    existing = load_discover_family_memory_map(user_id).get(family_key, {})
    memory = _reset_family_daily_counters(existing, day_key, active_day_number)
    action_value = str(action or "").strip().lower()

    row = {
        "id": str(memory.get("id") or uuid.uuid5(uuid.NAMESPACE_URL, f"{user_id}:{family_key}")),
        "user_id": user_id,
        "family_key": family_key,
        "family_label": family_label or memory.get("family_label") or family_key.replace("|", " ").replace("_", " ").title(),
        "shown_count_today": int(memory.get("shown_count_today") or 0),
        "last_shown_at": memory.get("last_shown_at"),
        "last_shown_day_key": memory.get("last_shown_day_key") or day_key,
        "last_shown_active_day": int(memory.get("last_shown_active_day") or active_day_number),
        "last_positive_at": memory.get("last_positive_at"),
        "last_negative_at": memory.get("last_negative_at"),
        "positive_seed_active_day": int(memory.get("positive_seed_active_day") or 0),
        "positive_followups_served": int(memory.get("positive_followups_served") or 0),
        "negative_seed_active_day": int(memory.get("negative_seed_active_day") or 0),
        "negative_followups_served": int(memory.get("negative_followups_served") or 0),
        "cooldown_until_active_day": int(memory.get("cooldown_until_active_day") or 0),
        "last_discover_active_at": _now_iso(),
        "created_at": memory.get("created_at") or _now_iso(),
        "updated_at": _now_iso(),
    }

    if action_value in {"love", "like"}:
        row["last_positive_at"] = _now_iso()
        row["positive_seed_active_day"] = active_day_number
        row["positive_followups_served"] = 0
        row["negative_seed_active_day"] = 0
        row["negative_followups_served"] = 0
    elif action_value == "dislike":
        row["last_negative_at"] = _now_iso()
        row["negative_seed_active_day"] = active_day_number
        row["negative_followups_served"] = 0

    return _table_upsert(TABLE_DISCOVER_FAMILY_MEMORY, row, conflict="user_id,family_key")


def load_style_preferences(user_id: str) -> List[dict]:
    return _table_load(TABLE_PREFERENCES, {"user_id": user_id})


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def _has_newer_interactions_than_preferences(user_id: str, rows: List[dict]) -> bool:
    if not rows:
        return False
    latest_pref_update = max(
        (_parse_iso_datetime(row.get("updated_at")) for row in rows),
        default=None,
    )
    if latest_pref_update is None:
        return True

    interactions = _table_load(TABLE_INTERACTIONS, {"user_id": user_id})
    latest_interaction = max(
        (_parse_iso_datetime(row.get("created_at")) for row in interactions),
        default=None,
    )
    if latest_interaction is None:
        return False
    return latest_interaction > latest_pref_update


def load_or_refresh_style_preferences(user_id: str) -> List[dict]:
    rows = load_style_preferences(user_id)
    total_interactions = count_discover_interactions(user_id)
    if total_interactions < 10:
        return rows

    if rows and not _has_newer_interactions_than_preferences(user_id, rows):
        return rows

    summary = refresh_user_style_preferences(user_id)
    refreshed_rows = summary.get("updated_rows") or []
    if refreshed_rows:
        return refreshed_rows
    return load_style_preferences(user_id)


def load_ignored_urls(user_id: str) -> List[str]:
    rows = _table_load(TABLE_IGNORED_URLS, {"user_id": user_id})
    effective_rows = [
        row for row in rows
        if str(row.get("reason") or "").lower() == "interaction"
    ]
    return [
        str(row.get("normalized_url") or row.get("source_url") or "")
        for row in effective_rows
        if row.get("normalized_url") or row.get("source_url")
    ]


def count_discover_interactions(user_id: str) -> int:
    return len(_table_load(TABLE_INTERACTIONS, {"user_id": user_id}))


def count_discover_interactions_today(user_id: str) -> int:
    return count_discover_interactions_for_day(user_id)


def count_discover_interactions_for_day(user_id: str, timezone_name: Optional[str] = None) -> int:
    try:
        target_tz = ZoneInfo(timezone_name) if timezone_name else datetime.now().astimezone().tzinfo or timezone.utc
    except Exception:
        target_tz = timezone.utc

    today = datetime.now(target_tz).date()
    count = 0
    for row in _table_load(TABLE_INTERACTIONS, {"user_id": user_id}):
        created_at = row.get("created_at")
        if not created_at:
            continue
        try:
            created_dt = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
        except Exception:
            continue
        if created_dt.astimezone(target_tz).date() == today:
            count += 1
    return count


def get_top_style_terms(user_id: str, limit: int = 2) -> Tuple[List[str], List[str]]:
    """
    Return the strongest positive and negative style terms for query seeding.
    Terms are returned as user-friendly labels so they can be dropped directly
    into a Google search query.
    """
    try:
        rows = load_style_preferences(user_id)
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        try:
            rows = load_style_preferences(user_id)
        except Exception:
            return [], []
    except Exception:
        return [], []
    if not rows:
        return [], []

    positive_rows = [
        row for row in rows
        if (row.get("score") or 0) > 0
        and row.get("status") in {"preferred", "emerging", "neutral"}
        and row.get("dimension") not in {"garment_type", "season", "occasion"}
    ]
    negative_rows = [
        row for row in rows
        if ((row.get("score") or 0) < 0 or row.get("status") == "disliked")
        and row.get("dimension") not in {"garment_type", "season", "occasion"}
    ]

    positive_rows.sort(key=lambda row: (row.get("score", 0), row.get("confidence", 0), row.get("exposure_count", 0)), reverse=True)
    negative_rows.sort(key=lambda row: (row.get("score", 0), row.get("confidence", 0), row.get("exposure_count", 0)))

    preferred: List[str] = []
    disliked: List[str] = []

    for row in positive_rows[:limit]:
        preferred.append(str(row.get("label") or row.get("style_key") or "").strip())
    for row in negative_rows[:limit]:
        disliked.append(str(row.get("label") or row.get("style_key") or "").strip())

    return [term for term in preferred if term], [term for term in disliked if term]


def record_discover_interaction(
    user_id: str,
    payload: Dict[str, Any],
    timezone_name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Persist a raw swipe action and mark the URL as seen so it will not be
    re-served in the next feed refresh.
    """
    style_ids = [str(style_id) for style_id in (payload.get("style_ids") or []) if str(style_id).strip()]
    style_tags = [normalize_style_tag(tag) for tag in (payload.get("style_tags") or []) if str(tag).strip()]
    if not style_ids and style_tags:
        style_ids, _ = get_style_ids_for_tags(style_tags)
    family_key, family_label, _ = build_discover_family_signature(style_ids, style_tags)
    family_key = _normalize_discover_family_key(family_key)
    if family_key and not str(family_label or "").strip():
        family_label = family_key.replace("|", " ").replace("_", " ").title()
    user_state = touch_discover_user_state(user_id, timezone_name)
    active_day_number = int(user_state.get("active_day_number") or 1)
    day_key = str(user_state.get("last_active_day_key") or _client_day_key(timezone_name))

    normalized_url = _canonical_url(payload.get("normalized_url") or payload.get("source_url") or "")
    row = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "card_id": payload.get("card_id") or str(uuid.uuid4()),
        "source_url": payload.get("source_url") or "",
        "normalized_url": normalized_url or payload.get("source_url") or "",
        "image_url": payload.get("image_url") or "",
        "thumbnail_url": payload.get("thumbnail_url"),
        "source_domain": payload.get("source_domain"),
        "title": payload.get("title") or "",
        "summary": payload.get("summary") or "",
        "search_query": payload.get("search_query"),
        "style_ids": style_ids,
        "style_tags": style_tags,
        "family_key": family_key,
        "family_label": family_label,
        "action": payload.get("action") or "like",
        "person_count": int(payload.get("person_count") or 1),
        "is_single_person": bool(payload.get("is_single_person", True)),
        "analysis": payload.get("analysis") or {},
        "interaction_index": payload.get("interaction_index"),
        "created_at": _now_iso(),
    }
    interaction = _table_insert(TABLE_INTERACTIONS, row)

    if row["normalized_url"]:
        upsert_ignored_url(
            user_id,
            {
                "source_url": row["source_url"],
                "normalized_url": row["normalized_url"],
                "image_url": row["image_url"],
                "thumbnail_url": row["thumbnail_url"],
                "source_domain": row["source_domain"],
                "search_query": row["search_query"],
                "last_action": row["action"],
                "reason": "interaction",
            },
        )

    if family_key:
        mark_discover_family_interaction(
            user_id,
            family_key,
            family_label,
            str(row["action"]),
            active_day_number,
            day_key,
        )

    return interaction


def _interaction_gate(total_interactions: int) -> float:
    if total_interactions < 10:
        return 0.0
    if total_interactions < 20:
        return 0.65
    if total_interactions < 30:
        return 0.85
    return 1.0


def refresh_user_style_preferences(user_id: str) -> Dict[str, Any]:
    """
    Aggregate raw interactions into per-style preference rows.
    No derived preferences are written until the user has enough interactions
    to make the signal trustworthy.
    """
    interactions = _table_load(TABLE_INTERACTIONS, {"user_id": user_id})
    total_interactions = len(interactions)
    gate = _interaction_gate(total_interactions)
    if gate <= 0:
        return {
            "total_interactions": total_interactions,
            "gate": gate,
            "updated": 0,
            "message": "Need at least 10 interactions before preferences are refreshed.",
        }

    style_lookup = get_style_lookup_by_id()

    aggregate: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "style_id": None,
        "style_key": "",
        "label": "",
        "dimension": "",
        "score_sum": 0.0,
        "exposure_count": 0,
        "love_count": 0,
        "like_count": 0,
        "dislike_count": 0,
        "last_seen_at": None,
    })

    for interaction in interactions:
        action = str(interaction.get("action") or "like").lower()
        action_weight = ACTION_WEIGHTS.get(action, 1.0)
        style_ids = [str(style_id) for style_id in (interaction.get("style_ids") or []) if str(style_id).strip()]
        if not style_ids and interaction.get("style_tags"):
            style_ids, _ = get_style_ids_for_tags(interaction.get("style_tags") or [])

        for style_id in style_ids:
            row = style_lookup.get(style_id)
            if not row:
                continue
            entry = aggregate[style_id]
            entry["style_id"] = style_id
            entry["style_key"] = str(row.get("style_key") or style_id)
            entry["label"] = str(row.get("label") or row.get("style_key") or style_id)
            entry["dimension"] = str(row.get("dimension") or "")
            entry["score_sum"] += action_weight
            entry["exposure_count"] += 1
            if action == "love":
                entry["love_count"] += 1
            elif action == "like":
                entry["like_count"] += 1
            elif action == "dislike":
                entry["dislike_count"] += 1
            entry["last_seen_at"] = interaction.get("created_at") or _now_iso()

    if not aggregate:
        return {
            "total_interactions": total_interactions,
            "gate": gate,
            "updated": 0,
            "updated_rows": [],
            "message": "Interactions recorded, but no recognized style signals found yet. Keep swiping!",
        }

    updated_rows: List[dict] = []
    _table_delete(TABLE_PREFERENCES, {"user_id": user_id})
    for style_id, entry in aggregate.items():
        exposure_count = max(1, int(entry["exposure_count"]))
        positive_count = int(entry["love_count"]) + int(entry["like_count"])
        negative_count = int(entry["dislike_count"])
        raw_score = float(entry["score_sum"]) / (exposure_count * 2.0)
        confidence = round(min(1.0, exposure_count / 5.0) * gate, 3)
        score = round(raw_score * gate, 3)

        positive_ratio = positive_count / exposure_count
        negative_ratio = negative_count / exposure_count
        # Thresholds scale with gate so they're reachable at every confidence level.
        # These are intentionally a bit softer so the preference rails start to
        # populate earlier once a user has a few consistent signals.
        preferred_threshold = round(0.3 * gate, 3)
        disliked_threshold  = round(-0.3 * gate, 3)

        if exposure_count < 2:
            status = "emerging"
        elif score >= preferred_threshold and positive_ratio >= 0.67 and positive_count >= 2:
            status = "preferred"
        elif score <= disliked_threshold and negative_ratio >= 0.67 and negative_count >= 2:
            status = "disliked"
        else:
            status = "neutral"

        row = {
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{user_id}:{style_id}")),
            "user_id": user_id,
            "style_id": style_id,
            "style_key": entry["style_key"],
            "label": entry["label"],
            "dimension": entry["dimension"],
            "score": score,
            "confidence": confidence,
            "exposure_count": exposure_count,
            "love_count": int(entry["love_count"]),
            "like_count": int(entry["like_count"]),
            "dislike_count": int(entry["dislike_count"]),
            "positive_count": positive_count,
            "negative_count": negative_count,
            "status": status,
            "last_interaction_at": entry["last_seen_at"],
            "updated_at": _now_iso(),
            "created_at": _now_iso(),
        }
        updated_rows.append(_table_upsert(TABLE_PREFERENCES, row, conflict="user_id,style_id"))

    return {
        "total_interactions": total_interactions,
        "gate": gate,
        "updated": len(updated_rows),
        "updated_rows": updated_rows,
    }


def build_profile_style_seed(user_id: str) -> Dict[str, List[str]]:
    try:
        preferred, disliked = get_top_style_terms(user_id, limit=2)
    except Exception:
        preferred, disliked = [], []
    return {
        "preferred": preferred,
        "disliked": disliked,
    }
