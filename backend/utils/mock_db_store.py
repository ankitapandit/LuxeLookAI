"""
utils/mock_db_store.py — In-memory database for local development
==================================================================
Simulates Supabase table operations so the full app works without
any external services. Data lives in Python dicts and is reset on
server restart.

Only used when USE_MOCK_AUTH=true (same flag as auth mock).
Switch off by setting USE_MOCK_AUTH=false in .env once Supabase is ready.
"""

from __future__ import annotations
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── In-memory tables ─────────────────────────────────────────────────────────
# Each table is a dict of { id -> row_dict }
_tables: Dict[str, Dict[str, dict]] = {
    "clothing_items":    {},
    "events":            {},
    "outfit_suggestions": {},
    "style_catalog":     {},
    "discover_candidates": {},
    "discover_ignored_urls": {},
    "discover_style_interactions": {},
    "user_style_preferences": {},
    "discover_jobs": {},
}


def _table(name: str) -> Dict[str, dict]:
    if name not in _tables:
        _tables[name] = {}
    return _tables[name]


# ── CRUD helpers ──────────────────────────────────────────────────────────────

def insert(table: str, row: dict) -> dict:
    """Insert a row. Row must have an 'id' field."""
    _table(table)[row["id"]] = row
    logger.debug(f"[MockDB] INSERT into {table}: id={row['id']}")
    return row


def select_all(table: str, filters: Optional[Dict[str, Any]] = None) -> List[dict]:
    """Return all rows matching optional equality filters."""
    rows = list(_table(table).values())
    if filters:
        for key, val in filters.items():
            rows = [r for r in rows if r.get(key) == val]
    return rows


def select_one(table: str, filters: Dict[str, Any]) -> Optional[dict]:
    """Return the first row matching all filters, or None."""
    rows = select_all(table, filters)
    return rows[0] if rows else None


def update(table: str, row_id: str, updates: dict, extra_filters: Optional[Dict[str, Any]] = None) -> Optional[dict]:
    """Update fields on a row by id. Returns updated row or None."""
    row = _table(table).get(row_id)
    if not row:
        return None
    # Check extra ownership filters (e.g. user_id must match)
    if extra_filters:
        for key, val in extra_filters.items():
            if row.get(key) != val:
                return None
    row.update(updates)
    logger.debug(f"[MockDB] UPDATE {table} id={row_id}: {updates}")
    return row


def delete(table: str, row_id: str, extra_filters: Optional[Dict[str, Any]] = None) -> bool:
    """Hard-delete a row by id. Returns True if deleted."""
    row = _table(table).get(row_id)
    if not row:
        return False
    if extra_filters:
        for key, val in extra_filters.items():
            if row.get(key) != val:
                return False
    del _table(table)[row_id]
    logger.debug(f"[MockDB] DELETE from {table} id={row_id}")
    return True


def soft_delete(table: str, row_id: str, extra_filters: Optional[Dict[str, Any]] = None) -> bool:
    """
    Soft-delete a row by setting is_active=False, is_archived=True and recording timestamps.
    The row stays in memory and can be restored via update().
    Returns True if found and marked inactive.
    """
    from datetime import datetime, timezone
    row = _table(table).get(row_id)
    if not row:
        return False
    if extra_filters:
        for key, val in extra_filters.items():
            if row.get(key) != val:
                return False
    archived_on = datetime.now(timezone.utc).isoformat()
    row["is_active"]   = False
    row["is_archived"]  = True
    row["deleted_at"]   = archived_on
    row["archived_on"]  = archived_on
    logger.debug(f"[MockDB] SOFT-DELETE from {table} id={row_id}")
    return True


def insert_many(table: str, rows: List[dict]) -> List[dict]:
    """Insert multiple rows at once."""
    return [insert(table, row) for row in rows]
