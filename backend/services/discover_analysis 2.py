"""
services/discover_analysis.py — Discover image analysis helpers
================================================================
Shared single-person and style-tag analysis for Discover images.
"""

from __future__ import annotations

import base64
import hashlib
import json
import random
import textwrap
from typing import Any, Dict, Tuple
from urllib.request import Request, urlopen

from config import get_settings
from services.style_catalog import get_style_catalog, get_style_catalog_prompt_block


def _download_bytes(url: str, timeout: int = 15) -> Tuple[bytes, str]:
    if not url:
        raise ValueError("Missing image URL")
    if url.startswith("data:"):
        header, encoded = url.split(",", 1)
        mime_type = header.split(";")[0].split(":", 1)[1] if ":" in header else "image/jpeg"
        return base64.b64decode(encoded), mime_type

    request = Request(url, headers={"User-Agent": "Mozilla/5.0 LuxeLookAI/1.0"})
    with urlopen(request, timeout=timeout) as response:  # nosec - backend fetch for image analysis
        mime_type = response.headers.get_content_type() or "image/jpeg"
        data = response.read()
        return data, mime_type


def _analysis_prompt() -> str:
    return textwrap.dedent(
        f"""
        You are analyzing a fashion inspiration image for a swipe feed.
        Return ONLY valid JSON, no markdown and no code fences.

        Required JSON shape:
        {{
          "single_person": true,
          "person_count": 1,
          "title": "2 to 5 word title",
          "summary": "one concise sentence about the look",
          "style_tags": ["tailored", "plaid", "wool"],
          "source_note": "short phrase about why it is a useful inspiration"
        }}

        Rules:
        - If the image clearly shows more than one person, set single_person=false and person_count to the estimated count.
        - If the image does not show one clear fashion subject, set single_person=false.
        - Prefer 4 to 6 tags.
        - Only use style_tags from this allowed vocabulary:
        {get_style_catalog_prompt_block()}
        - Focus on the outfit and styling, not the background.
        - The title should be editorial but short.
        - The summary should be plain English and useful for a fashion feed.
        """
    ).strip()


def _mock_analyze_image(query: str, image_url: str) -> Dict[str, Any]:
    catalog = get_style_catalog()
    seed = int(hashlib.sha1(f"{query}:{image_url}".encode("utf-8")).hexdigest()[:8], 16)
    rng = random.Random(seed)
    chosen = rng.sample(
        [row["style_key"] for row in catalog if row["dimension"] in {"silhouette", "fabric", "pattern", "vibe", "color_family", "styling_detail"}],
        k=4,
    )
    return {
        "single_person": True,
        "person_count": 1,
        "title": " ".join(tag.replace("_", " ").title() for tag in chosen[:2]),
        "summary": f"A single-person look with {chosen[0].replace('_', ' ')} and {chosen[1].replace('_', ' ')} energy.",
        "style_tags": chosen,
        "source_note": "Mock inspiration card",
    }


def analyze_discover_image(query: str, image_url: str) -> Dict[str, Any]:
    settings = get_settings()
    if settings.use_mock_ai:
        parsed = _mock_analyze_image(query, image_url)
        return parsed

    from openai import OpenAI

    image_bytes, mime_type = _download_bytes(image_url)
    client = OpenAI(api_key=settings.openai_api_key)
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        temperature=0.1,
        max_tokens=280,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime_type};base64,{encoded}"},
                },
                {
                    "type": "text",
                    "text": _analysis_prompt(),
                },
            ],
        }],
    )
    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    parsed = json.loads(raw.strip())
    parsed["style_tags"] = [str(tag).strip().lower() for tag in (parsed.get("style_tags") or []) if str(tag).strip()]
    return parsed
