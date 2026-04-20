"""
services/page_visit_service.py — Lightweight route-level visit logging
======================================================================
Stores authenticated page entry/exit events so the product can reason about
which surfaces are actually used without collecting clickstream or movement data.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from httpx import RemoteProtocolError
from postgrest.exceptions import APIError

from config import get_settings

TABLE_PAGE_VISITS = "user_page_visits"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _table_insert(table: str, row: dict) -> dict:
    def run() -> dict:
        settings = get_settings()
        if settings.use_mock_auth:
            from utils.mock_db_store import insert
            return insert(table, row)

        from utils.db import get_supabase

        try:
            result = get_supabase().table(table).insert(row).execute()
            return result.data[0]
        except APIError as exc:
            # If the insert actually succeeded and the client retried, return
            # the existing row instead of crashing on the duplicate primary key.
            if str(getattr(exc, "message", "") or "").find("duplicate key value violates unique constraint") >= 0:
                existing = (
                    get_supabase()
                    .table(table)
                    .select("*")
                    .eq("id", row["id"])
                    .eq("user_id", row["user_id"])
                    .limit(1)
                    .execute()
                )
                if existing.data:
                    return existing.data[0]
            raise

    try:
        return run()
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        return run()


def _table_update(table: str, row_id: str, updates: dict, user_id: str) -> Optional[dict]:
    def run() -> Optional[dict]:
        settings = get_settings()
        if settings.use_mock_auth:
            from utils.mock_db_store import update
            return update(table, row_id, updates, extra_filters={"user_id": user_id})

        from utils.db import get_supabase

        result = (
            get_supabase()
            .table(table)
            .update(updates)
            .eq("id", row_id)
            .eq("user_id", user_id)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    try:
        return run()
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        return run()


def start_page_visit(user_id: str, payload: Dict[str, Any]) -> dict:
    entered_at = payload.get("entered_at")
    if isinstance(entered_at, datetime):
        entered_at_value = entered_at.astimezone(timezone.utc).isoformat()
    elif entered_at:
        entered_at_value = str(entered_at)
    else:
        entered_at_value = _now_iso()

    row = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "session_id": str(payload.get("session_id") or "").strip(),
        "page_key": str(payload.get("page_key") or "").strip(),
        "referrer_page_key": payload.get("referrer_page_key"),
        "entered_at": entered_at_value,
        "source": str(payload.get("source") or "web").strip() or "web",
        "context_json": payload.get("context_json") or {},
        "created_at": _now_iso(),
    }
    return _table_insert(TABLE_PAGE_VISITS, row)


def end_page_visit(user_id: str, visit_id: str, payload: Dict[str, Any]) -> dict:
    left_at = payload.get("left_at")
    if isinstance(left_at, datetime):
        left_at_value = left_at.astimezone(timezone.utc).isoformat()
    elif left_at:
        left_at_value = str(left_at)
    else:
        left_at_value = _now_iso()

    updates = {
        "left_at": left_at_value,
        "duration_ms": payload.get("duration_ms"),
    }
    row = _table_update(TABLE_PAGE_VISITS, visit_id, updates, user_id)
    if row:
        return row
    return {
        "id": visit_id,
        "left_at": left_at_value,
        "duration_ms": payload.get("duration_ms"),
    }
