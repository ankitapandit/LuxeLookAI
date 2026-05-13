from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional


_BRANDS_PATH = Path(__file__).resolve().parent.parent / "assets" / "brands.json"


@lru_cache(maxsize=1)
def load_brand_catalog() -> List[Dict[str, Any]]:
    with _BRANDS_PATH.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        raise ValueError("Brand catalog must be a list")
    return data


@lru_cache(maxsize=1)
def _brand_lookup() -> Dict[str, str]:
    lookup: Dict[str, str] = {}
    for entry in load_brand_catalog():
        label = str(entry.get("label", "")).strip()
        if not label:
            continue
        lookup[label.lower()] = label
        for alias in entry.get("aliases", []) or []:
            alias_text = str(alias).strip()
            if alias_text:
                lookup[alias_text.lower()] = label
    return lookup


def get_brand_labels() -> List[str]:
    return [str(entry["label"]) for entry in load_brand_catalog() if entry.get("label")]


def normalize_brand_label(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    return _brand_lookup().get(cleaned.lower())
