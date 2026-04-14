"""
services/discover_service.py — Provider-backed inspiration feed
===============================================================
Builds the Discover feed from pluggable image-search providers, filters for
single-person fashion images, and converts the survivors into swipeable
cards with style tags.
"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Dict, List, Optional

from httpx import RemoteProtocolError

from config import get_settings
from services.discover_candidates import (
    build_card_from_candidate,
    load_ready_discover_candidates,
    seed_discover_candidates,
)
from services.style_learning import (
    build_profile_style_seed,
    count_discover_interactions,
    count_discover_interactions_for_day,
    DAILY_DISCOVER_LIMIT,
    load_ignored_urls,
    load_or_refresh_style_preferences,
)
from utils.auth import get_current_user_id  # noqa: F401  # imported for router docs


def _current_season() -> str:
    month = datetime.utcnow().month
    if month in (12, 1, 2):
        return "winter"
    if month in (3, 4, 5):
        return "spring"
    if month in (6, 7, 8):
        return "summer"
    return "fall"


def _gender_term(gender: Optional[str]) -> str:
    value = (gender or "").strip().lower()
    if value in {"woman", "trans_woman"}:
        return "woman"
    if value in {"man", "trans_man"}:
        return "man"
    if value in {"non_binary", "nonbinary", "other", "prefer_not_to_say"}:
        return "fashion"
    return "fashion"


def _build_search_query(profile: Dict[str, Any], style_seed: Dict[str, List[str]]) -> str:
    complexion = (profile.get("complexion") or "").strip().lower()
    complexion_phrase = f"{complexion} skin" if complexion else ""
    season = _current_season()
    gender = _gender_term(profile.get("gender"))

    positive = [term for term in style_seed.get("preferred", []) if term]
    negative = [f"-{term}" for term in style_seed.get("disliked", []) if term]

    parts = [part for part in [complexion_phrase, gender, season, "outfit"] if part]
    if positive:
        parts.extend(positive[:3])
    if negative:
        parts.extend(negative[:3])
    # parts.append("editorial")
    return " ".join(parts)


def _profile_context(profile: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "gender": profile.get("gender") or "prefer_not_to_say",
        "ethnicity": profile.get("ethnicity") or "prefer_not_to_say",
        "body_type": profile.get("body_type"),
        "shoulders": profile.get("shoulders"),
        "complexion": profile.get("complexion"),
        "age_range": profile.get("age_range"),
        "hairstyle": profile.get("hairstyle"),
        "season": _current_season(),
    }


def get_discover_seed_context(user_id: str) -> Dict[str, Any]:
    profile = _load_user_profile(user_id)
    style_seed = build_profile_style_seed(user_id)
    return {
        "profile": profile,
        "profile_context": _profile_context(profile),
        "style_seed": style_seed,
        "seed_query": _build_search_query(profile, style_seed),
    }


def build_discover_feed(user_id: str, limit: int = 6, timezone_name: Optional[str] = None) -> Dict[str, Any]:
    settings = get_settings()
    seed_context = get_discover_seed_context(user_id)
    style_seed = seed_context["style_seed"]
    query = seed_context["seed_query"]
    try:
        ignore_urls = set(load_ignored_urls(user_id))
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        ignore_urls = set(load_ignored_urls(user_id))
    ignored_count = len(ignore_urls)
    warming_up = False
    queued_job_id = None
    cards: List[Dict[str, Any]] = []

    try:
        ready_rows = load_ready_discover_candidates(user_id, exclude_urls=ignore_urls)
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        ready_rows = load_ready_discover_candidates(user_id, exclude_urls=ignore_urls)
    for row in ready_rows[:limit]:
        card = build_card_from_candidate(row)
        cards.append(card)

    if len(cards) < limit:
        from services.discover_jobs import enqueue_seed_candidates_job

        seed_limit = min(max(limit + 2, 8), 10)
        if settings.use_mock_auth:
            seed_result = seed_discover_candidates(user_id, query, limit=seed_limit)
            ready_rows = load_ready_discover_candidates(user_id, exclude_urls=ignore_urls)
            cards = []
            for row in ready_rows[:limit]:
                card = build_card_from_candidate(row)
                cards.append(card)
        else:
            job = enqueue_seed_candidates_job(user_id, query, limit=seed_limit)
            warming_up = True
            queued_job_id = str(job.get("id") or "")

    return {
        "seed_query": query,
        "profile_context": seed_context["profile_context"],
        "cards": cards[:limit],
        "ignored_url_count": ignored_count,
        "total_interactions": _safe_count_interactions(user_id),
        "daily_interactions": _safe_count_interactions_today(user_id, timezone_name),
        "daily_limit": DAILY_DISCOVER_LIMIT,
        "preference_rows": _safe_load_style_preferences(user_id),
        "style_seed": style_seed,
        "warming_up": warming_up and len(cards) == 0,
        "queued_job_id": queued_job_id,
    }


def _load_user_profile(user_id: str) -> Dict[str, Any]:
    settings = get_settings()
    if settings.use_mock_auth:
        from utils.mock_db_store import select_one
        from utils.mock_auth_store import get_mock_user_profile

        row = select_one("users", {"id": user_id})
        if row:
            return row
        return get_mock_user_profile(user_id) or {}

    from utils.db import get_supabase

    try:
        result = get_supabase().table("users").select("*").eq("id", user_id).single().execute()
        return result.data or {}
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        result = get_supabase().table("users").select("*").eq("id", user_id).single().execute()
        return result.data or {}


def _safe_count_interactions(user_id: str) -> int:
    try:
        return count_discover_interactions(user_id)
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        return count_discover_interactions(user_id)


def _safe_count_interactions_today(user_id: str, timezone_name: Optional[str]) -> int:
    try:
        return count_discover_interactions_for_day(user_id, timezone_name)
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        return count_discover_interactions_for_day(user_id, timezone_name)


def _safe_load_style_preferences(user_id: str) -> List[dict]:
    try:
        return load_or_refresh_style_preferences(user_id)
    except RemoteProtocolError:
        from utils.db import reset_supabase_client
        reset_supabase_client()
        return load_or_refresh_style_preferences(user_id)
