"""
services/discover_jobs.py — Durable Discover background jobs
=============================================================
Provides a minimal DB-backed queue so Discover intelligence can move off the
request path without bringing in a heavyweight orchestrator yet.
"""

from __future__ import annotations

import socket
import time
import uuid
from hashlib import sha1
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from config import get_settings
from services.discover_candidates import seed_discover_candidates
from services.style_learning import refresh_user_style_preferences

TABLE_DISCOVER_JOBS = "discover_jobs"
JOB_REFRESH_STYLE_PREFERENCES = "refresh_style_preferences"
JOB_SEED_DISCOVER_CANDIDATES = "seed_discover_candidates"
JOB_STATUS_QUEUED = "queued"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_SUCCEEDED = "succeeded"
JOB_STATUS_FAILED = "failed"


def _is_permanent_discover_error(message: str) -> bool:
    lowered = (message or "").lower()
    permanent_markers = [
        "pexels 400",
        "pexels 401",
        "pexels 403",
        "invalid key",
        "api key not valid",
        "forbidden",
        "permission denied",
        "daily limit exceeded",
        "billing",
        "unauthorized",
        "authorization",
    ]
    return any(marker in lowered for marker in permanent_markers)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def _insert_row(table: str, row: dict) -> dict:
    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import insert
        return insert(table, row)

    from utils.db import get_supabase

    result = get_supabase().table(table).insert(row).execute()
    return result.data[0]


def _update_row(table: str, row_id: str, updates: dict, extra_filters: Optional[Dict[str, Any]] = None) -> Optional[dict]:
    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import update
        return update(table, row_id, updates, extra_filters=extra_filters)

    from utils.db import get_supabase

    query = get_supabase().table(table).update(updates).eq("id", row_id)
    if extra_filters:
        for key, value in extra_filters.items():
            query = query.eq(key, value)
    result = query.execute()
    return (result.data or [None])[0]


def list_discover_jobs(
    user_id: Optional[str] = None,
    statuses: Optional[List[str]] = None,
    job_type: Optional[str] = None,
) -> List[dict]:
    rows = _load_rows(TABLE_DISCOVER_JOBS, {"user_id": user_id} if user_id else None)
    if statuses:
        status_set = {status.strip().lower() for status in statuses if status}
        rows = [row for row in rows if str(row.get("status") or "").lower() in status_set]
    if job_type:
        rows = [row for row in rows if str(row.get("job_type") or "") == job_type]
    return sorted(
        rows,
        key=lambda row: (
            int(row.get("priority") or 100),
            str(row.get("scheduled_for") or ""),
            str(row.get("created_at") or ""),
        ),
    )


def get_discover_job(job_id: str, user_id: str) -> Optional[dict]:
    rows = _load_rows(TABLE_DISCOVER_JOBS, {"id": job_id, "user_id": user_id})
    return rows[0] if rows else None


def get_discover_status_summary(user_id: str) -> Dict[str, Any]:
    rows = list_discover_jobs(user_id=user_id)
    queued = sum(1 for row in rows if str(row.get("status") or "") == JOB_STATUS_QUEUED)
    running = sum(1 for row in rows if str(row.get("status") or "") == JOB_STATUS_RUNNING)
    failed = sum(1 for row in rows if str(row.get("status") or "") == JOB_STATUS_FAILED)

    latest_seed = next((row for row in reversed(rows) if str(row.get("job_type") or "") == JOB_SEED_DISCOVER_CANDIDATES), None)
    latest_refresh = next((row for row in reversed(rows) if str(row.get("job_type") or "") == JOB_REFRESH_STYLE_PREFERENCES), None)
    latest_failed = next((row for row in reversed(rows) if str(row.get("status") or "") == JOB_STATUS_FAILED), None)

    return {
        "queued_count": queued,
        "running_count": running,
        "failed_count": failed,
        "latest_seed_job": latest_seed,
        "latest_refresh_job": latest_refresh,
        "latest_failed_job": latest_failed,
    }


def enqueue_discover_job(
    user_id: str,
    job_type: str,
    payload: Optional[Dict[str, Any]] = None,
    dedupe_key: Optional[str] = None,
    priority: int = 100,
    max_attempts: int = 3,
) -> dict:
    existing = []
    if dedupe_key:
        existing = [
            row for row in list_discover_jobs(
                user_id=user_id,
                statuses=[JOB_STATUS_QUEUED, JOB_STATUS_RUNNING],
                job_type=job_type,
            )
            if str(row.get("dedupe_key") or "") == dedupe_key
        ]
    if existing:
        print(
            f"[Discover] job deduped user={user_id} job_type={job_type} dedupe_key={dedupe_key!r} existing_job_id={existing[0].get('id')} existing_status={existing[0].get('status')}",
            flush=True,
        )
        return existing[0]

    now = _now_iso()
    row = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "job_type": job_type,
        "status": JOB_STATUS_QUEUED,
        "priority": priority,
        "payload": payload or {},
        "dedupe_key": dedupe_key,
        "attempts": 0,
        "max_attempts": max_attempts,
        "scheduled_for": now,
        "locked_at": None,
        "locked_by": None,
        "last_error": None,
        "result": None,
        "created_at": now,
        "updated_at": now,
    }
    inserted = _insert_row(TABLE_DISCOVER_JOBS, row)
    print(
        f"[Discover] job enqueued user={user_id} job_id={inserted.get('id')} job_type={job_type} priority={priority} dedupe_key={dedupe_key!r} payload={payload or {}}",
        flush=True,
    )
    return inserted


def enqueue_refresh_preferences_job(user_id: str, interaction_index: Optional[int] = None) -> dict:
    bucket = max(1, int((interaction_index or 0) / 10)) if interaction_index else int(time.time())
    dedupe_key = f"refresh-preferences:{bucket}"
    return enqueue_discover_job(
        user_id=user_id,
        job_type=JOB_REFRESH_STYLE_PREFERENCES,
        payload={"interaction_index": interaction_index},
        dedupe_key=dedupe_key,
        priority=20,
    )


def enqueue_seed_candidates_job(user_id: str, query: str, limit: int = 18) -> dict:
    digest = sha1(query.strip().lower().encode("utf-8")).hexdigest()[:16]
    return enqueue_discover_job(
        user_id=user_id,
        job_type=JOB_SEED_DISCOVER_CANDIDATES,
        payload={"query": query, "limit": limit},
        dedupe_key=f"seed-candidates:{digest}",
        priority=10,
    )


def claim_next_discover_job(worker_id: Optional[str] = None) -> Optional[dict]:
    worker_name = worker_id or socket.gethostname()
    for row in list_discover_jobs(statuses=[JOB_STATUS_QUEUED]):
        claimed = _update_row(
            TABLE_DISCOVER_JOBS,
            str(row["id"]),
            {
                "status": JOB_STATUS_RUNNING,
                "locked_at": _now_iso(),
                "locked_by": worker_name,
                "attempts": int(row.get("attempts") or 0) + 1,
                "updated_at": _now_iso(),
            },
            extra_filters={"status": JOB_STATUS_QUEUED},
        )
        if claimed:
            print(
                f"[Discover] job claimed worker={worker_name} job_id={claimed.get('id')} job_type={claimed.get('job_type')} user={claimed.get('user_id')} attempts={claimed.get('attempts')}",
                flush=True,
            )
            return claimed
    return None


def complete_discover_job(job_id: str, result: Optional[Dict[str, Any]] = None) -> Optional[dict]:
    completed = _update_row(
        TABLE_DISCOVER_JOBS,
        job_id,
        {
            "status": JOB_STATUS_SUCCEEDED,
            "result": result or {},
            "locked_at": None,
            "locked_by": None,
            "last_error": None,
            "updated_at": _now_iso(),
        },
    )
    print(f"[Discover] job completed job_id={job_id} result={result or {}}", flush=True)
    return completed


def fail_discover_job(job: dict, error_message: str) -> Optional[dict]:
    attempts = int(job.get("attempts") or 0)
    max_attempts = int(job.get("max_attempts") or 3)
    terminal = attempts >= max_attempts or _is_permanent_discover_error(error_message)
    failed = _update_row(
        TABLE_DISCOVER_JOBS,
        str(job["id"]),
        {
            "status": JOB_STATUS_FAILED if terminal else JOB_STATUS_QUEUED,
            "locked_at": None,
            "locked_by": None,
            "last_error": error_message[:2000],
            "updated_at": _now_iso(),
        },
    )
    print(
        f"[Discover] job failed job_id={job.get('id')} job_type={job.get('job_type')} terminal={terminal} attempts={attempts} max_attempts={max_attempts} error={error_message!r}",
        flush=True,
    )
    return failed


def process_discover_job(job: dict) -> Dict[str, Any]:
    job_type = str(job.get("job_type") or "")
    user_id = str(job.get("user_id") or "")
    print(f"[Discover] job processing job_id={job.get('id')} job_type={job_type} user={user_id}", flush=True)
    if job_type == JOB_REFRESH_STYLE_PREFERENCES:
        return refresh_user_style_preferences(user_id)
    if job_type == JOB_SEED_DISCOVER_CANDIDATES:
        payload = job.get("payload") or {}
        query = str(payload.get("query") or "").strip()
        limit = int(payload.get("limit") or 18)
        if not query:
            raise ValueError("Missing query for seed_discover_candidates job")
        return seed_discover_candidates(user_id, query, limit=limit)
    raise ValueError(f"Unsupported Discover job type: {job_type}")


def work_once(worker_id: Optional[str] = None) -> Optional[dict]:
    job = claim_next_discover_job(worker_id=worker_id)
    if not job:
        return None
    try:
        result = process_discover_job(job)
        complete_discover_job(str(job["id"]), result=result)
        print(f"[Discover] worker completed job_id={job['id']} job_type={job.get('job_type')}", flush=True)
        return result
    except Exception as exc:
        fail_discover_job(job, str(exc))
        print(f"[Discover] worker exception job_id={job.get('id')} error={exc!r}", flush=True)
        raise
