"""
services/discover_candidates.py — Discover candidate cache and analysis
=======================================================================
Stores analyzed Discover image candidates so feed assembly can read from a
ready pool while background workers handle search + vision analysis.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set

from config import get_settings
from services.discover_analysis import analyze_discover_image
from services.discover_search import search_discover_images
from services.style_catalog import get_style_ids_for_tags
from services.style_learning import _canonical_url

TABLE_DISCOVER_CANDIDATES = "discover_candidates"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_rate_limit_error(error: Exception) -> bool:
    return "rate limit" in str(error).lower() or "429" in str(error)


def _load_rows(table: str, filters: Optional[Dict[str, Any]] = None) -> List[dict]:
    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import select_all
        return select_all(table, filters)

    from utils.db import get_supabase

    query = get_supabase().table(table).select("*")
    if filters:
        for key, value in filters.items():
            query = query.eq(key, value)
    result = query.execute()
    return result.data or []


def _upsert_row(table: str, row: dict, conflict: str) -> dict:
    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import insert, select_one, update

        if conflict == "user_id,normalized_url":
            existing = select_one(table, {"user_id": row["user_id"], "normalized_url": row["normalized_url"]})
        else:
            existing = select_one(table, {"id": row["id"]})
        if existing:
            return update(table, str(existing["id"]), row, extra_filters={"user_id": row["user_id"]}) or existing
        return insert(table, row)

    from utils.db import get_supabase

    result = get_supabase().table(table).upsert(row, on_conflict=conflict).execute()
    return result.data[0]


def upsert_discover_candidate(user_id: str, payload: Dict[str, Any]) -> dict:
    normalized_url = _canonical_url(payload.get("normalized_url") or payload.get("source_url") or payload.get("image_url") or "")
    row = {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{user_id}:{normalized_url}")),
        "user_id": user_id,
        "normalized_url": normalized_url,
        "source_url": payload.get("source_url") or "",
        "image_url": payload.get("image_url") or "",
        "thumbnail_url": payload.get("thumbnail_url"),
        "source_domain": payload.get("source_domain"),
        "provider_name": payload.get("provider_name"),
        "title": payload.get("title") or "Fashion edit",
        "summary": payload.get("summary"),
        "source_note": payload.get("source_note"),
        "search_query": payload.get("search_query"),
        "status": payload.get("status") or "queued",
        "analysis": payload.get("analysis") or {},
        "style_tags": payload.get("style_tags") or [],
        "style_ids": payload.get("style_ids") or [],
        "person_count": int(payload.get("person_count") or 0),
        "is_single_person": bool(payload.get("is_single_person", False)),
        "last_error": payload.get("last_error"),
        "last_analyzed_at": payload.get("last_analyzed_at"),
        "created_at": payload.get("created_at") or _now_iso(),
        "updated_at": _now_iso(),
    }
    return _upsert_row(TABLE_DISCOVER_CANDIDATES, row, conflict="user_id,normalized_url")


def load_ready_discover_candidates(user_id: str, exclude_urls: Optional[Iterable[str]] = None) -> List[dict]:
    excluded: Set[str] = {str(url) for url in (exclude_urls or []) if str(url)}
    rows = _load_rows(TABLE_DISCOVER_CANDIDATES, {"user_id": user_id})
    ready_rows = [
        row for row in rows
        if str(row.get("status") or "") == "ready"
        and str(row.get("normalized_url") or "") not in excluded
    ]
    return sorted(
        ready_rows,
        key=lambda row: (
            str(row.get("last_analyzed_at") or row.get("updated_at") or ""),
            str(row.get("created_at") or ""),
        ),
        reverse=True,
    )


def build_card_from_candidate(row: dict) -> dict:
    normalized = str(row.get("normalized_url") or "")
    return {
        "id": hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:16],
        "source_url": row.get("source_url") or row.get("image_url") or "",
        "normalized_url": normalized,
        "image_url": row.get("image_url") or row.get("thumbnail_url") or "",
        "thumbnail_url": row.get("thumbnail_url") or row.get("image_url") or "",
        "display_image_url": row.get("thumbnail_url") or row.get("image_url") or "",
        "source_domain": row.get("source_domain") or row.get("provider_name") or "discover",
        "title": row.get("title") or "Fashion edit",
        "summary": row.get("summary") or "Single-person inspiration.",
        "source_note": row.get("source_note") or "",
        "style_tags": row.get("style_tags") or [],
        "style_ids": row.get("style_ids") or [],
        "person_count": int(row.get("person_count") or 1),
        "is_single_person": bool(row.get("is_single_person", True)),
        "search_query": row.get("search_query"),
        "analysis": row.get("analysis") or {},
    }


def seed_discover_candidates(user_id: str, query: str, limit: int = 18) -> Dict[str, Any]:
    print(f"[Discover] candidate-seed start user={user_id} query={query!r} limit={limit}", flush=True)
    provider_name, candidates = search_discover_images(query, limit=limit)
    print(
        f"[Discover] candidate-search complete user={user_id} provider={provider_name} raw_candidates={len(candidates)}",
        flush=True,
    )
    ready_count = 0
    filtered_count = 0
    failed_count = 0
    rate_limited = False

    for index, candidate in enumerate(candidates, start=1):
        source_url = candidate.get("source_url") or candidate.get("image_url") or ""
        image_url = candidate.get("image_url") or source_url
        thumbnail_url = candidate.get("thumbnail_url") or image_url
        normalized = _canonical_url(source_url or image_url)
        if not normalized or not image_url:
            print(
                f"[Discover] candidate skipped user={user_id} index={index} reason=missing-url source_url={source_url!r} image_url={image_url!r}",
                flush=True,
            )
            continue

        base_row = {
            "source_url": source_url,
            "normalized_url": normalized,
            "image_url": image_url,
            "thumbnail_url": thumbnail_url,
            "source_domain": candidate.get("source_domain"),
            "provider_name": provider_name,
            "title": candidate.get("title") or "Fashion edit",
            "search_query": query,
            "status": "queued",
        }
        upsert_discover_candidate(user_id, base_row)
        try:
            analysis = analyze_discover_image(query, image_url)
        except Exception as exc:
            failed_count += 1
            print(
                f"[Discover] candidate analysis-failed user={user_id} index={index} normalized_url={normalized!r} error={exc!r}",
                flush=True,
            )
            upsert_discover_candidate(
                user_id,
                {
                    **base_row,
                    "status": "failed",
                    "last_error": str(exc),
                    "last_analyzed_at": _now_iso(),
                },
            )
            if _is_rate_limit_error(exc):
                rate_limited = True
                print(
                    f"[Discover] candidate-seed paused-for-rate-limit user={user_id} index={index} query={query!r}",
                    flush=True,
                )
                break
            continue

        if not analysis.get("single_person", False) or int(analysis.get("person_count") or 0) != 1:
            filtered_count += 1
            upsert_discover_candidate(
                user_id,
                {
                    **base_row,
                    "status": "filtered",
                    "analysis": analysis,
                    "person_count": int(analysis.get("person_count") or 0),
                    "is_single_person": False,
                    "summary": analysis.get("summary") or "Filtered out of the Discover feed.",
                    "source_note": analysis.get("source_note") or "",
                    "last_analyzed_at": _now_iso(),
                },
            )
            continue

        style_ids, style_labels = get_style_ids_for_tags(analysis.get("style_tags") or [])
        ready_count += 1
        upsert_discover_candidate(
            user_id,
            {
                **base_row,
                "status": "ready",
                "analysis": analysis,
                "title": analysis.get("title") or candidate.get("title") or "Fashion edit",
                "summary": analysis.get("summary") or "Single-person inspiration.",
                "source_note": analysis.get("source_note") or "",
                "style_tags": analysis.get("style_tags") or style_labels,
                "style_ids": style_ids,
                "person_count": int(analysis.get("person_count") or 1),
                "is_single_person": True,
                "last_analyzed_at": _now_iso(),
            },
        )

    summary = {
        "provider_name": provider_name,
        "search_query": query,
        "requested": len(candidates),
        "ready_count": ready_count,
        "filtered_count": filtered_count,
        "failed_count": failed_count,
        "rate_limited": rate_limited,
    }
    print(f"[Discover] candidate-seed complete user={user_id} summary={summary}", flush=True)
    return summary
