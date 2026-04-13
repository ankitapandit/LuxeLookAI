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
DAILY_DISCOVER_LIMIT = 10

ACTION_WEIGHTS: Dict[str, float] = {
    "love": 2.0,
    "like": 1.0,
    "dislike": -2.0,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def load_style_preferences(user_id: str) -> List[dict]:
    return _table_load(TABLE_PREFERENCES, {"user_id": user_id})


def load_or_refresh_style_preferences(user_id: str) -> List[dict]:
    rows = load_style_preferences(user_id)
    if rows:
        return rows

    total_interactions = count_discover_interactions(user_id)
    if total_interactions < 10:
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


def record_discover_interaction(user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Persist a raw swipe action and mark the URL as seen so it will not be
    re-served in the next feed refresh.
    """
    style_ids = [str(style_id) for style_id in (payload.get("style_ids") or []) if str(style_id).strip()]
    style_tags = [normalize_style_tag(tag) for tag in (payload.get("style_tags") or []) if str(tag).strip()]
    if not style_ids and style_tags:
        style_ids, _ = get_style_ids_for_tags(style_tags)

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
