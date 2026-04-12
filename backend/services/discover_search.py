"""
services/discover_search.py — Discover search providers
=======================================================
Normalizes image-search candidates from whichever upstream provider is active
so the rest of Discover can stay provider-agnostic.
"""

from __future__ import annotations

import base64
import hashlib
import json
import random
from typing import Any, Dict, List, Tuple
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from config import get_settings
from services.style_catalog import get_style_catalog

PEXELS_SEARCH_ENDPOINT = "https://api.pexels.com/v1/search"


def _mock_placeholder_svg(title: str, subtitle: str, accent: str) -> str:
    safe_title = title.replace("&", "&amp;")
    safe_subtitle = subtitle.replace("&", "&amp;")
    svg = f"""
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#241D17"/>
          <stop offset="100%" stop-color="#120E0B"/>
        </linearGradient>
        <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="{accent}" stop-opacity="0.14"/>
          <stop offset="100%" stop-color="#E7D4B2" stop-opacity="0.03"/>
        </linearGradient>
      </defs>
      <rect width="900" height="1200" fill="url(#bg)"/>
      <rect x="48" y="48" width="804" height="1104" rx="56" fill="url(#glow)" stroke="#D4A96A" stroke-opacity="0.18"/>
      <circle cx="150" cy="160" r="94" fill="{accent}" fill-opacity="0.18"/>
      <circle cx="750" cy="260" r="126" fill="#E7D4B2" fill-opacity="0.08"/>
      <text x="72" y="1080" font-family="Georgia, serif" font-size="70" fill="#FFF7ED">{safe_title}</text>
      <text x="72" y="1142" font-family="DM Sans, Arial, sans-serif" font-size="28" fill="#EED8B8">{safe_subtitle}</text>
    </svg>
    """.strip()
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("utf-8")


def _mock_search_results(query: str, limit: int = 12) -> List[Dict[str, Any]]:
    catalog = get_style_catalog()
    palette = ["#D4A96A", "#A97D56", "#C48B6D", "#8B6C4C", "#D6B47F"]
    results: List[Dict[str, Any]] = []
    seed = int(hashlib.sha1(query.encode("utf-8")).hexdigest()[:8], 16)
    rng = random.Random(seed)
    selected = [row for row in catalog if row["dimension"] in {"silhouette", "fabric", "pattern", "vibe", "color_family"}]
    rng.shuffle(selected)

    for idx, row in enumerate(selected[:limit]):
        title = f"{row['label']} Edit"
        subtitle = f"{row['dimension'].replace('_', ' ').title()} • single-person inspiration"
        source_url = f"mock://discover/{row['style_key']}/{idx}"
        image_url = _mock_placeholder_svg(title, subtitle, palette[idx % len(palette)])
        results.append({
            "source_url": source_url,
            "image_url": image_url,
            "thumbnail_url": image_url,
            "title": title,
            "source_domain": "mock",
        })
    return results


def _extract_http_error_detail(exc: HTTPError) -> str:
    body = ""
    try:
        body = exc.read().decode("utf-8", errors="replace")
    except Exception:
        body = ""

    if not body:
        return str(exc.reason or "").strip()

    try:
        parsed = json.loads(body)
    except Exception:
        return body[:400].strip()

    for candidate in (
        parsed.get("error"),
        parsed.get("errors"),
        parsed,
    ):
        if isinstance(candidate, dict):
            message = str(candidate.get("message") or candidate.get("error") or "").strip()
            code = str(candidate.get("code") or candidate.get("status") or "").strip()
            detail = f"{code}: {message}".strip(": ").strip()
            if detail:
                return detail
    return body[:400].strip()


def _pexels_search(query: str, limit: int = 12) -> List[Dict[str, Any]]:
    settings = get_settings()
    key = getattr(settings, "pexels_api_key", "")
    if not key:
        return _mock_search_results(query, limit=limit)
    params = {
        "query": query,
        "per_page": min(max(limit, 1), 80),
        "page": 1,
    }
    request = Request(
        f"{PEXELS_SEARCH_ENDPOINT}?{urlencode(params)}",
        headers={
            "Authorization": key,
            "User-Agent": "LuxeLookAI/1.0",
        },
    )

    try:
        with urlopen(request, timeout=20) as response:  # nosec - backend fetch for search API
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = _extract_http_error_detail(exc)
        if detail:
            raise RuntimeError(f"Pexels {exc.code}: {detail}") from exc
        raise RuntimeError(f"Pexels {exc.code}: {exc.reason}") from exc

    results: List[Dict[str, Any]] = []
    for photo in data.get("photos", [])[:limit]:
        src = photo.get("src") or {}
        photographer = str(photo.get("photographer") or "").strip()
        photo_url = str(photo.get("url") or "").strip()
        image_url = (
            src.get("large2x")
            or src.get("large")
            or src.get("original")
            or src.get("portrait")
            or src.get("medium")
            or src.get("small")
            or photo_url
        )
        thumbnail_url = (
            src.get("medium")
            or src.get("small")
            or src.get("large")
            or image_url
        )
        if not image_url:
            continue
        title = str(photo.get("alt") or "").strip() or f"{query.title()} inspiration"
        source_note = f"Photo by {photographer} on Pexels" if photographer else "Photo from Pexels"
        results.append({
            "source_url": photo_url or image_url,
            "image_url": image_url,
            "thumbnail_url": thumbnail_url,
            "title": title,
            "summary": "Editorial inspiration from Pexels.",
            "source_note": source_note,
            "source_domain": urlsplit(photo_url).netloc or "pexels.com",
        })
    return results


def resolve_discover_search_provider() -> str:
    settings = get_settings()
    provider = str(getattr(settings, "discover_search_provider", "auto") or "auto").strip().lower()
    if provider in {"", "auto"}:
        if getattr(settings, "pexels_api_key", ""):
            return "pexels"
        return "mock"
    if provider == "pexels":
        return provider
    if provider == "mock":
        return provider
    return "mock"


def search_discover_images(query: str, limit: int = 12) -> Tuple[str, List[Dict[str, Any]]]:
    provider = resolve_discover_search_provider()
    if provider == "pexels":
        return provider, _pexels_search(query, limit=limit)
    return "mock", _mock_search_results(query, limit=limit)
