"""
services/discover_analysis.py — Discover image analysis helpers
================================================================
Shared single-person and style-tag analysis for Discover images.

In real mode this uses the cached Hugging Face CLIP pipeline that already
powers wardrobe tagging, so Discover does not burn OpenAI tokens on every
candidate image.
"""

from __future__ import annotations

import base64
import hashlib
import random
from io import BytesIO
from typing import Any, Dict, List, Tuple
from urllib.request import Request, urlopen

from PIL import Image

from config import get_settings
from ml.tagger import _get_clip_pipeline
from services.style_catalog import get_style_catalog

DISCOVER_ANALYSIS_VERSION = "discover_pattern_guard_v2"

DIMENSION_ORDER = [
    "silhouette",
    "fabric",
    "pattern",
    "color_family",
    "vibe",
    "styling_detail",
]

PERSON_SCENE_LABELS: List[Tuple[str, str]] = [
    (
        "single_person",
        "a fashion photo of one person modeling a clearly visible outfit",
    ),
    (
        "multiple_people",
        "a fashion photo with multiple people visible",
    ),
    (
        "product_only",
        "a clothing product photo, flat lay, or mannequin image without a person",
    ),
    (
        "close_up",
        "a close-up portrait or tightly cropped image where the outfit is not clearly visible",
    ),
]


def _focused_outfit_crop(image: Image.Image) -> Image.Image:
    """
    Reduce scene contamination for Discover style tags.

    We keep the existing full-image single-person detection, but classify
    clothing style on a tighter central crop so bouquets, trees, and other
    off-axis props are less likely to dominate tags like "floral".

    This is intentionally heuristic and easy to revert.
    """
    width, height = image.size
    if width < 320 or height < 320:
        return image

    portrait_ratio = height / max(width, 1)
    if portrait_ratio >= 1.2:
        width_frac = 0.72
        top_trim = 0.04
        bottom_trim = 0.03
    elif portrait_ratio >= 0.9:
        width_frac = 0.78
        top_trim = 0.05
        bottom_trim = 0.04
    else:
        width_frac = 0.68
        top_trim = 0.06
        bottom_trim = 0.05

    crop_width = max(int(width * width_frac), min(width, 256))
    left = max((width - crop_width) // 2, 0)
    right = min(left + crop_width, width)
    top = max(int(height * top_trim), 0)
    bottom = min(int(height * (1.0 - bottom_trim)), height)

    if right - left < 160 or bottom - top < 220:
        return image
    return image.crop((left, top, right, bottom))


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


def _load_image(image_url: str) -> Image.Image:
    image_bytes, _mime_type = _download_bytes(image_url)
    return Image.open(BytesIO(image_bytes)).convert("RGB")


def _classify(image: Image.Image, label_pairs: List[Tuple[str, str]]) -> List[Dict[str, Any]]:
    classifier = _get_clip_pipeline()
    prompts = [prompt for _, prompt in label_pairs]
    raw_results = classifier(image, candidate_labels=prompts)
    prompt_to_key = {prompt: key for key, prompt in label_pairs}
    results: List[Dict[str, Any]] = []
    for row in raw_results:
        prompt = str(row.get("label") or "")
        if prompt not in prompt_to_key:
            continue
        results.append(
            {
                "key": prompt_to_key[prompt],
                "prompt": prompt,
                "score": float(row.get("score") or 0.0),
            }
        )
    return results


def _person_scene_analysis(image: Image.Image) -> Dict[str, Any]:
    results = _classify(image, PERSON_SCENE_LABELS)
    best = results[0] if results else {"key": "product_only", "score": 0.0}
    best_key = str(best.get("key") or "product_only")
    if best_key == "single_person":
        return {
            "single_person": True,
            "person_count": 1,
            "scene_label": best_key,
            "scene_score": float(best.get("score") or 0.0),
        }
    if best_key == "multiple_people":
        return {
            "single_person": False,
            "person_count": 2,
            "scene_label": best_key,
            "scene_score": float(best.get("score") or 0.0),
        }
    return {
        "single_person": False,
        "person_count": 0,
        "scene_label": best_key,
        "scene_score": float(best.get("score") or 0.0),
    }


def _style_prompt(row: Dict[str, Any]) -> str:
    label = str(row.get("label") or row.get("style_key") or "").strip().lower()
    dimension = str(row.get("dimension") or "").strip().lower()
    if dimension == "silhouette":
        return f"a fashion outfit with a {label} silhouette"
    if dimension == "fabric":
        return f"a fashion outfit featuring {label} fabric or texture"
    if dimension == "pattern":
        return f"a fashion outfit with a {label} pattern"
    if dimension == "color_family":
        return f"a fashion outfit in a {label} color palette"
    if dimension == "vibe":
        return f"a {label} fashion outfit"
    if dimension == "styling_detail":
        return f"a fashion outfit with {label} styling details"
    return f"a fashion outfit that feels {label}"


def _rank_dimension_candidates(
    image: Image.Image,
    rows: List[Dict[str, Any]],
    limit: int = 3,
) -> List[Dict[str, Any]]:
    if not rows:
        return []
    label_pairs = [(str(row["style_key"]), _style_prompt(row)) for row in rows]
    results = _classify(image, label_pairs)
    if not results:
        return []
    by_key = {str(row["style_key"]): row for row in rows}
    enriched: List[Dict[str, Any]] = []
    for index, row in enumerate(results[:limit]):
        matched = by_key.get(str(row.get("key") or ""))
        if not matched:
            continue
        next_score = float(results[index + 1].get("score") or 0.0) if index + 1 < len(results) else 0.0
        enriched.append(
            {
                "style_key": matched["style_key"],
                "label": matched.get("label") or matched["style_key"],
                "dimension": matched.get("dimension"),
                "score": float(row.get("score") or 0.0),
                "next_score": next_score,
                "score_margin": float(row.get("score") or 0.0) - next_score,
            }
        )
    return enriched


def _rank_dimension(image: Image.Image, rows: List[Dict[str, Any]]) -> Dict[str, Any] | None:
    candidates = _rank_dimension_candidates(image, rows, limit=2)
    return candidates[0] if candidates else None


def _passes_pattern_guard(best: Dict[str, Any]) -> bool:
    style_key = str(best.get("style_key") or "")
    score = float(best.get("score") or 0.0)
    margin = float(best.get("score_margin") or 0.0)

    if style_key == "solid":
        return score >= 0.24
    if style_key in {"plaid", "animal_print"}:
        return score >= 0.30 and margin >= 0.03
    if style_key == "stripe":
        # Tree trunks, railings, path lines, and long coat edges can mimic stripes.
        return score >= 0.34 and margin >= 0.05
    if style_key == "floral":
        # Bouquet / garden props can falsely trigger floral. Require a clearer win.
        return score >= 0.36 and margin >= 0.06
    if style_key == "abstract":
        # Painterly / busy scenes can leak into this label.
        return score >= 0.30 and margin >= 0.03
    if style_key == "geometric":
        # Sidewalks, brick, railings, and clean urban lines can falsely trigger this.
        return score >= 0.34 and margin >= 0.05
    if style_key == "polka_dot":
        # Leaves / gravel / repeated highlights can masquerade as dot prints.
        return score >= 0.33 and margin >= 0.05
    return True


def _should_prefer_solid(best: Dict[str, Any], solid_candidate: Dict[str, Any] | None) -> bool:
    if not solid_candidate:
        return False

    style_key = str(best.get("style_key") or "")
    if style_key not in {"floral", "abstract", "geometric", "polka_dot", "stripe"}:
        return False

    best_score = float(best.get("score") or 0.0)
    solid_score = float(solid_candidate.get("score") or 0.0)
    if solid_score < 0.24:
        return False

    if style_key == "floral":
        closeness = 0.10
    elif style_key in {"geometric", "stripe"}:
        closeness = 0.06
    else:
        closeness = 0.04
    return solid_score >= best_score - closeness


def _choose_pattern_tag(image: Image.Image, rows: List[Dict[str, Any]]) -> Dict[str, Any] | None:
    candidates = _rank_dimension_candidates(image, rows, limit=4)
    if not candidates:
        return None

    best = candidates[0]
    solid_candidate = next((candidate for candidate in candidates if str(candidate.get("style_key")) == "solid"), None)
    if _should_prefer_solid(best, solid_candidate):
        return solid_candidate

    if _passes_pattern_guard(best):
        return best

    # If a noisy pattern only weakly wins, prefer "solid" when it is close.
    if solid_candidate:
        best_score = float(best.get("score") or 0.0)
        solid_score = float(solid_candidate.get("score") or 0.0)
        if solid_score >= 0.24 and solid_score >= best_score - 0.04:
            return solid_candidate
    if solid_candidate and _passes_pattern_guard(solid_candidate):
        return solid_candidate
    return None


def _extract_style_tags(image: Image.Image) -> List[str]:
    catalog = get_style_catalog()
    tags: List[str] = []
    for dimension in DIMENSION_ORDER:
        rows = [row for row in catalog if str(row.get("dimension") or "") == dimension]
        best = _choose_pattern_tag(image, rows) if dimension == "pattern" else _rank_dimension(image, rows)
        if not best:
            continue
        threshold = 0.18 if dimension in {"vibe", "styling_detail"} else 0.24
        if float(best["score"]) < threshold:
            continue
        tags.append(str(best["style_key"]))

    if not tags:
        fallback_rows = [
            row for row in catalog
            if str(row.get("dimension") or "") in {"vibe", "color_family"}
        ]
        fallback = _rank_dimension(image, fallback_rows)
        if fallback:
            tags.append(str(fallback["style_key"]))

    return tags[:6]


def _title_from_tags(tags: List[str]) -> str:
    if not tags:
        return "Styled Moment"
    readable = [tag.replace("_", " ").title() for tag in tags[:2]]
    return " ".join(readable)


def _summary_from_tags(tags: List[str]) -> str:
    if not tags:
        return "A single-person fashion look with clear outfit styling."
    readable = [tag.replace("_", " ") for tag in tags]
    if len(readable) == 1:
        return f"A single-person look with {readable[0]} energy."
    if len(readable) == 2:
        return f"A single-person look with {readable[0]} shape and {readable[1]} energy."
    return f"A single-person look with {readable[0]} shape, {readable[1]} texture, and {readable[2]} energy."


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
        return _mock_analyze_image(query, image_url)

    image = _load_image(image_url)
    scene = _person_scene_analysis(image)
    analysis_image = _focused_outfit_crop(image) if scene["single_person"] else image
    style_tags = _extract_style_tags(analysis_image) if scene["single_person"] else []
    return {
        "single_person": bool(scene["single_person"]),
        "person_count": int(scene["person_count"]),
        "title": _title_from_tags(style_tags),
        "summary": _summary_from_tags(style_tags),
        "style_tags": style_tags,
        "analysis_version": DISCOVER_ANALYSIS_VERSION,
        "source_note": "HF CLIP analysis (focused outfit crop)",
        "scene_label": scene["scene_label"],
        "scene_score": scene["scene_score"],
    }
