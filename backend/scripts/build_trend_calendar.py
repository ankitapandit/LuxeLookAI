#!/usr/bin/env python3
"""
scripts/build_trend_calendar.py
================================
One-time (per-season) script that processes the Myntra Fashion Product Images
Dataset into a trend_calendar.json for LuxeLook AI's trend scoring.

Dataset
-------
Myntra Fashion Product Images Dataset — MIT license
https://www.kaggle.com/datasets/paramaggarwal/fashion-product-images-dataset

Download the single metadata file (no images needed):
    pip install kaggle
    kaggle datasets download paramaggarwal/fashion-product-images-dataset -f styles.csv

Usage
-----
    python scripts/build_trend_calendar.py path/to/styles.csv [--output path/to/trend_calendar.json]

Output is written to backend/assets/fashion_rules/trend_calendar.json by default.

Refresh cadence: run once per season (4x / year).
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict

# ── Load Kaggle credentials from .env via config.py ──────────────────────────
# Adds backend/ to path so config.py is importable when running this script
# directly from the backend/ directory.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
try:
    from config import get_settings
    _s = get_settings()
    if _s.kaggle_username and _s.kaggle_key:
        os.environ.setdefault("KAGGLE_USERNAME", _s.kaggle_username)
        os.environ.setdefault("KAGGLE_KEY",      _s.kaggle_key)
except Exception:
    pass  # credentials will be picked up from environment if already set

# ── Vocabulary mappings ───────────────────────────────────────────────────────
# Maps Myntra baseColour values (lowercased) → our internal color names

COLOUR_MAP: Dict[str, str] = {
    "black":         "black",
    "white":         "white",
    "off white":     "white",
    "cream":         "cream",
    "blue":          "blue",
    "turquoise blue":"blue",
    "teal":          "blue",
    "sea green":     "green",
    "dark blue":     "navy",
    "navy blue":     "navy",
    "brown":         "brown",
    "coffee brown":  "brown",
    "chocolate":     "brown",
    "copper":        "brown",
    "bronze":        "brown",
    "pink":          "pink",
    "mauve":         "pink",
    "rose":          "pink",
    "blush":         "pink",
    "baby pink":     "pink",
    "peach":         "orange",
    "coral":         "orange",
    "orange":        "orange",
    "rust":          "rust",
    "red":           "red",
    "maroon":        "burgundy",
    "burgundy":      "burgundy",
    "wine":          "burgundy",
    "green":         "green",
    "lime green":    "green",
    "dark green":    "green",
    "lime":          "yellow",
    "yellow":        "yellow",
    "mustard":       "yellow",
    "grey":          "grey",
    "gray":          "grey",
    "grey melange":  "grey",
    "charcoal":      "grey",
    "beige":         "beige",
    "nude":          "beige",
    "wheat":         "beige",
    "khaki":         "olive",
    "olive":         "olive",
    "tan":           "tan",
    "camel":         "camel",
    "purple":        "purple",
    "lavender":      "lavender",
    "violet":        "purple",
    "gold":          "gold",
    "silver":        "silver",
}

# Maps Myntra usage → our vibe vocabulary
USAGE_TO_VIBE: Dict[str, str] = {
    "casual":       "Off-Duty + Effortless",
    "formal":       "Elegant + Confident",
    "smart casual": "Minimalist + Clean",
    "sports":       "Sporty + Chic",
    "party":        "Playful + Confident",
    "ethnic":       "Boho + Free",
    "western":      "Playful + Confident",
    "travel":       "Off-Duty + Effortless",
    "home":         "Off-Duty + Effortless",
}

# Maps Myntra articleType (lowercased substrings) → our fit_check vocabulary
# Checked in order; first match wins.
ARTICLE_TO_FIT: list = [
    (["bodycon", "jegging"],                        "Bodycon"),
    (["maxi", "flare", "palazzo", "wide leg"],      "Flowing"),
    (["casual trouser", "jogger", "sweatpant",
      "sweater", "sweatshirt", "hoodie", "shorts",
      "skirt", "mini"],                             "Relaxed"),
    (["blazer", "suit", "formal trouser",
      "formal shirt", "formal"],                    "Structured"),
    (["jean", "trouser", "pant", "chino",
      "capri", "cigarette"],                        "Tailored"),
    ([],                                            "Relaxed"),   # default
]


def _map_article_to_fit(article_type: str) -> str:
    at = article_type.lower()
    for keywords, fit in ARTICLE_TO_FIT:
        if any(k in at for k in keywords):
            return fit
    return "Relaxed"


def _normalize_scores(counts: Dict[str, int]) -> Dict[str, float]:
    """Normalize raw counts to 0–1 scores (max count = 1.0)."""
    if not counts:
        return {}
    max_count = max(counts.values())
    return {k: round(v / max_count, 4) for k, v in counts.items()}


def build_calendar(csv_path: str) -> Dict:
    try:
        import pandas as pd
    except ImportError:
        print("pandas is required: pip install pandas")
        sys.exit(1)

    print(f"Loading {csv_path} ...")
    df = pd.read_csv(csv_path, on_bad_lines="skip")
    print(f"  Loaded {len(df):,} rows, columns: {list(df.columns)}")

    # ── Filter to women's apparel ─────────────────────────────────────────────
    df = df[df["masterCategory"].str.lower() == "apparel"]
    df = df[df["gender"].str.lower().isin(["women", "girls", "unisex"])]
    print(f"  After gender/category filter: {len(df):,} rows")

    # ── Normalise season column ───────────────────────────────────────────────
    df["season"] = df["season"].str.lower().str.strip()
    df = df[df["season"].isin(["spring", "summer", "fall", "winter"])]
    print(f"  After season filter: {len(df):,} rows")

    calendar: Dict = {}

    for season in ["spring", "summer", "fall", "winter"]:
        sdf = df[df["season"] == season]
        if sdf.empty:
            print(f"  WARNING: no rows for season={season}")
            continue
        print(f"  Processing {season}: {len(sdf):,} rows")

        # Color counts → scores
        color_counts: Dict[str, int] = defaultdict(int)
        for raw in sdf["baseColour"].dropna():
            mapped = COLOUR_MAP.get(raw.lower().strip())
            if mapped:
                color_counts[mapped] += 1

        # Vibe counts (via usage)
        vibe_counts: Dict[str, int] = defaultdict(int)
        for raw in sdf["usage"].dropna():
            mapped = USAGE_TO_VIBE.get(raw.lower().strip())
            if mapped:
                vibe_counts[mapped] += 1

        # Fit check counts (via articleType)
        fit_counts: Dict[str, int] = defaultdict(int)
        for raw in sdf["articleType"].dropna():
            fit_counts[_map_article_to_fit(raw)] += 1

        calendar[season] = {
            "colors":       _normalize_scores(dict(color_counts)),
            "vibe":         _normalize_scores(dict(vibe_counts)),
            "fit_check":    _normalize_scores(dict(fit_counts)),
            # color_theory is not directly derivable from single-item data;
            # retain editorial values from existing calendar where present.
        }

    return calendar


def merge_with_existing(new_data: Dict, existing_path: str) -> Dict:
    """
    Merge new Myntra-derived scores with existing calendar.
    Myntra data wins for colors/vibe/fit_check.
    Existing editorial values fill in color_theory (not in dataset).
    """
    try:
        with open(existing_path) as f:
            existing = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        existing = {}

    merged = {"_meta": existing.get("_meta", {})}
    for season in ["spring", "summer", "fall", "winter"]:
        new_season    = new_data.get(season, {})
        exist_season  = existing.get(season, {})
        merged[season] = {
            "colors":       new_season.get("colors",       exist_season.get("colors", {})),
            "vibe":         new_season.get("vibe",         exist_season.get("vibe", {})),
            "color_theory": exist_season.get("color_theory", {}),   # editorial only
            "fit_check":    new_season.get("fit_check",    exist_season.get("fit_check", {})),
        }
    return merged


def main() -> None:
    parser = argparse.ArgumentParser(description="Build trend_calendar.json from Myntra styles.csv")
    parser.add_argument("csv_path", help="Path to Myntra styles.csv")
    parser.add_argument(
        "--output", "-o",
        default=os.path.join(
            os.path.dirname(__file__),
            "..",
            "assets",
            "fashion_rules",
            "trend_calendar.json",
        ),
        help="Output path (default: backend/assets/fashion_rules/trend_calendar.json)",
    )
    args = parser.parse_args()

    new_data = build_calendar(args.csv_path)
    merged   = merge_with_existing(new_data, args.output)

    with open(args.output, "w") as f:
        json.dump(merged, f, indent=2)

    print(f"\nWrote trend_calendar.json → {args.output}")
    for season, data in merged.items():
        if season.startswith("_"):
            continue
        print(f"  {season}: {len(data.get('colors', {}))} colors, "
              f"{len(data.get('vibe', {}))} vibes, "
              f"{len(data.get('fit_check', {}))} fit_checks")


if __name__ == "__main__":
    main()
