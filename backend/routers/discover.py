"""
routers/discover.py — Discover feed and swipe logging
======================================================
GET  /discover/feed         — build a seeded Google image feed
POST /discover/interaction  — log like/love/dislike events
POST /discover/recompute    — force a preference aggregation pass
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from httpx import RemoteProtocolError

from models.schemas import (
    DiscoverFeedResponse,
    DiscoverInteractionRequest,
    DiscoverInteractionResponse,
    DiscoverJobResponse,
    DiscoverPrewarmResponse,
    DiscoverRetrySeedResponse,
    DiscoverStatusResponse,
)
from services.discover_candidates import load_ready_discover_candidates
from services.discover_jobs import enqueue_refresh_preferences_job, enqueue_seed_candidates_job, get_discover_job, get_discover_status_summary
from services.discover_service import build_discover_feed, get_discover_seed_context
from services.style_learning import count_discover_interactions, load_ignored_urls, load_or_refresh_style_preferences, record_discover_interaction, refresh_user_style_preferences
from services.style_learning import DAILY_DISCOVER_LIMIT, count_discover_interactions_for_day
from utils.auth import get_current_user_id

router = APIRouter()


def _client_timezone(request: Request) -> str | None:
    value = request.headers.get("X-Client-Timezone")
    return value.strip() if value and value.strip() else None


@router.post("/prewarm", response_model=DiscoverPrewarmResponse)
def discover_prewarm(
    minimum_ready: int = Query(6, ge=1, le=24),
    user_id: str = Depends(get_current_user_id),
):
    seed_context = get_discover_seed_context(user_id)
    query = str(seed_context.get("seed_query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Could not build Discover seed query")

    try:
        ignored_urls = set(load_ignored_urls(user_id))
        ready_rows = load_ready_discover_candidates(user_id, exclude_urls=ignored_urls)
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        ignored_urls = set(load_ignored_urls(user_id))
        ready_rows = load_ready_discover_candidates(user_id, exclude_urls=ignored_urls)
    ready_count = len(ready_rows)
    if ready_count >= minimum_ready:
        return DiscoverPrewarmResponse(
            status="ready",
            seed_query=query,
            ready_count=ready_count,
        )

    job = enqueue_seed_candidates_job(user_id, query=query, limit=max(minimum_ready * 3, 12))
    return DiscoverPrewarmResponse(
        status="queued",
        seed_query=query,
        ready_count=ready_count,
        queued_job_id=str(job.get("id") or ""),
        queued_job_status=str(job.get("status") or "queued"),
    )


@router.get("/feed", response_model=DiscoverFeedResponse)
def discover_feed(
    request: Request,
    limit: int = Query(6, ge=1, le=12),
    user_id: str = Depends(get_current_user_id),
):
    """
    Build a Discover feed from Google image search using the user's profile
    context plus any learned style signals.
    """
    try:
        return build_discover_feed(user_id, limit=limit, timezone_name=_client_timezone(request))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not build Discover feed: {exc}")


@router.post("/interaction", response_model=DiscoverInteractionResponse)
def discover_interaction(
    request: Request,
    payload: DiscoverInteractionRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Persist a swipe interaction and optionally refresh the per-style summary.
    The frontend is expected to call this endpoint for every like/love/dislike.
    """
    timezone_name = _client_timezone(request)
    daily_interactions = count_discover_interactions_for_day(user_id, timezone_name)
    if daily_interactions >= DAILY_DISCOVER_LIMIT:
        raise HTTPException(
            status_code=429,
            detail="You have reached your daily quota, please come back tomorrow for more inspiring ideas.",
        )

    interaction = record_discover_interaction(user_id, payload.model_dump())
    total_interactions = count_discover_interactions(user_id)
    daily_interactions = count_discover_interactions_for_day(user_id, timezone_name)
    summary = None
    updated_preferences = []
    commit_triggered = False

    if payload.commit_preferences or (
        payload.interaction_index is not None and payload.interaction_index > 0 and payload.interaction_index % 10 == 0
    ):
        summary = refresh_user_style_preferences(user_id)
        updated_preferences = summary.get("updated_rows", []) or []
        commit_triggered = True

    return DiscoverInteractionResponse(
        status="recorded",
        ignored_url=interaction.get("normalized_url"),
        commit_triggered=commit_triggered,
        total_interactions=total_interactions,
        daily_interactions=daily_interactions,
        daily_limit=DAILY_DISCOVER_LIMIT,
        preference_summary=summary,
        updated_preferences=updated_preferences,
    )


@router.post("/recompute", response_model=DiscoverInteractionResponse)
def discover_recompute(request: Request, user_id: str = Depends(get_current_user_id)):
    """
    Force a recomputation of the taste profile from all stored interactions.
    Handy after a batch of 10/20/30 swipes or for admin/debug usage.
    """
    summary = refresh_user_style_preferences(user_id)
    return DiscoverInteractionResponse(
        status="recomputed",
        commit_triggered=summary.get("gate", 0) > 0,
        total_interactions=count_discover_interactions(user_id),
        daily_interactions=count_discover_interactions_for_day(user_id, _client_timezone(request)),
        daily_limit=DAILY_DISCOVER_LIMIT,
        message=summary.get("message"),
        preference_summary=summary,
        updated_preferences=summary.get("updated_rows", []) or [],
    )


@router.get("/jobs/{job_id}", response_model=DiscoverJobResponse)
def discover_job_status(
    job_id: str,
    user_id: str = Depends(get_current_user_id),
):
    job = get_discover_job(job_id, user_id)
    if not job:
        raise HTTPException(status_code=404, detail="Discover job not found")
    return DiscoverJobResponse(
        id=str(job.get("id") or ""),
        job_type=str(job.get("job_type") or ""),
        status=str(job.get("status") or ""),
        result=job.get("result") or None,
        last_error=job.get("last_error") or None,
        attempts=int(job.get("attempts") or 0),
        max_attempts=int(job.get("max_attempts") or 0),
        locked_at=job.get("locked_at"),
        updated_at=job.get("updated_at"),
    )


def _serialize_job(job: dict | None) -> DiscoverJobResponse | None:
    if not job:
        return None
    return DiscoverJobResponse(
        id=str(job.get("id") or ""),
        job_type=str(job.get("job_type") or ""),
        status=str(job.get("status") or ""),
        result=job.get("result") or None,
        last_error=job.get("last_error") or None,
        attempts=int(job.get("attempts") or 0),
        max_attempts=int(job.get("max_attempts") or 0),
        locked_at=job.get("locked_at"),
        updated_at=job.get("updated_at"),
    )


@router.get("/status", response_model=DiscoverStatusResponse)
def discover_status(request: Request, user_id: str = Depends(get_current_user_id)):
    try:
        summary = get_discover_status_summary(user_id)
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        summary = get_discover_status_summary(user_id)
    try:
        total_interactions = count_discover_interactions(user_id)
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        total_interactions = count_discover_interactions(user_id)

    try:
        daily_interactions = count_discover_interactions_for_day(user_id, _client_timezone(request))
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        daily_interactions = count_discover_interactions_for_day(user_id, _client_timezone(request))

    try:
        preference_rows = load_or_refresh_style_preferences(user_id)
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        preference_rows = load_or_refresh_style_preferences(user_id)

    return DiscoverStatusResponse(
        total_interactions=total_interactions,
        daily_interactions=daily_interactions,
        daily_limit=DAILY_DISCOVER_LIMIT,
        preference_rows=preference_rows,
        queued_count=int(summary.get("queued_count") or 0),
        running_count=int(summary.get("running_count") or 0),
        failed_count=int(summary.get("failed_count") or 0),
        latest_seed_job=_serialize_job(summary.get("latest_seed_job")),
        latest_refresh_job=_serialize_job(summary.get("latest_refresh_job")),
        latest_failed_job=_serialize_job(summary.get("latest_failed_job")),
    )


@router.post("/retry-seed", response_model=DiscoverRetrySeedResponse)
def discover_retry_seed(user_id: str = Depends(get_current_user_id)):
    seed_context = get_discover_seed_context(user_id)
    query = str(seed_context.get("seed_query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Could not build Discover seed query")
    job = enqueue_seed_candidates_job(user_id, query=query, limit=18)
    return DiscoverRetrySeedResponse(
        status="queued",
        queued_job_id=str(job.get("id") or ""),
        queued_job_status=str(job.get("status") or "queued"),
        seed_query=query,
    )
