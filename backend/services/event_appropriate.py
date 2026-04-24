"""
services/event_appropriate.py — Multi-dimensional event alignment scorer
=========================================================================
Replaces the single-axis appropriateness scorer with a per-dimension
breakdown that mirrors every field the user fills in the EventBriefEditor.

Dimensions (weighted):
  dress_code   — formality alignment                     0.30
  mood         — style mood / vibe match                 0.25
  time_of_day  — evening / daytime fit                   0.20
  weather      — fabric / coverage / footwear fit        0.15
  purpose      — occasion purpose fit                    0.10

Hard veto rules (applied before weighted average):
  Rule 1: dress_code score < VETO_THRESHOLD (0.40)
          → outfit eliminated regardless of other scores.
          Rationale: you cannot wear casual clothes to a cocktail event,
          no matter how good the color story is.

  Rule 2: time_of_day is explicitly specified AND time_of_day score < 0.35
          → outfit eliminated.
          Rationale: a summer halter for a rainy evening date is wrong
          even if the formality is technically correct.

Fallback logic:
  Dimensions with no event signal (e.g. no mood specified) default to
  NEUTRAL (0.50) so the scorer never punishes an outfit for a missing brief
  parameter — it only rewards or penalises known signals.

Usage from recommender.py:
  from services.event_appropriate import score_event_appropriate
  ea_score, dim_scores, ea_label = score_event_appropriate(outfit_items, occasion)
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────
VETO_THRESHOLD = 0.40   # below this → hard veto (dress_code dim only)
TIME_VETO      = 0.35   # below this → hard veto (time_of_day dim, when specified)
NEUTRAL        = 0.50   # default when a dimension has no event signal

# ── Dimension weights (must sum to 1.0) ────────────────────────────────────────
_DIM_WEIGHTS: Dict[str, float] = {
    "dress_code":  0.30,
    "mood":        0.25,
    "time_of_day": 0.20,
    "weather":     0.15,
    "purpose":     0.10,
}
assert abs(sum(_DIM_WEIGHTS.values()) - 1.0) < 1e-9, "_DIM_WEIGHTS must sum to 1.0"

# ── Fabric vocabularies ────────────────────────────────────────────────────────
_EVENING_FABRICS: Set[str] = {
    "velvet", "satin", "sequin", "sequins", "lace", "silk", "organza",
    "chantilly", "brocade", "taffeta", "metallic", "lamé", "crepe",
    "duchess satin", "charmeuse",
}
_DAYTIME_FABRICS: Set[str] = {
    "linen", "cotton", "denim", "chambray", "jersey", "terry cloth",
    "flannel", "corduroy", "twill", "poplin", "canvas", "chambray",
}
_HEAVY_FABRICS: Set[str] = {
    "wool", "cashmere", "fleece", "knit", "waffle-knit", "sherpa",
    "faux-fur", "faux fur", "tweed", "leather", "suede", "shearling",
}
_BREATHABLE_FABRICS: Set[str] = {
    "linen", "cotton", "chiffon", "bamboo", "rayon", "silk", "satin",
    "muslin", "georgette",
}
_DELICATE_FABRICS: Set[str] = {
    "silk", "chiffon", "organza", "lace", "satin", "charmeuse",
}

# ── Color groups ───────────────────────────────────────────────────────────────
_NEUTRAL_COLORS: Set[str] = {
    "black", "white", "beige", "cream", "ivory", "grey", "gray",
    "nude", "camel", "tan", "khaki", "charcoal", "silver",
}
_DARK_RICH_COLORS: Set[str] = {
    "black", "navy", "burgundy", "forest green", "emerald", "plum",
    "charcoal", "chocolate", "midnight", "deep red", "oxblood",
}
_ROMANTIC_COLORS: Set[str] = {
    "blush", "pink", "rose", "cream", "ivory", "white", "lavender",
    "lilac", "dusty rose", "mauve", "champagne", "red", "soft pink",
}
_BOLD_COLORS: Set[str] = {
    "red", "cobalt", "yellow", "mustard", "orange", "coral",
    "fuchsia", "lime", "hot pink", "neon", "electric blue",
}

# Colors that unambiguously read as daytime / tropical / summery.
# Restricted to neons and lime/chartreuse family — colors that are NEVER
# appropriate for evening dressing regardless of styling.
# Bold-but-wearable evening colors (coral, hot pink, electric blue, cobalt,
# fuchsia) are intentionally excluded: they are evening-capable in the right
# silhouette and should not be hard-coded as daytime.
_SUMMERY_COLORS: Set[str] = {
    "lime", "lime green", "chartreuse", "neon green", "neon yellow",
    "neon pink", "neon orange", "bright yellow", "yellow green",
    "teal green", "tropical green",
}

# Broader vivid-summer palette.  Used as a SOFTENER only (versatile score
# 0.72 → 0.45) when we know the event is both summer AND evening.  These
# colours can still work at evening in the right silhouette/fabric, they
# just shouldn't get full "versatile" credit at a summer night event.
# Fabric checks in _is_evening_item() still take priority — a silk coral
# dress is classified evening-coded before we ever reach this set.
_SUMMER_VIVID_COLORS: Set[str] = {
    "coral", "hot coral", "bright coral",
    "tropical orange", "bright orange",
    "turquoise", "aqua", "sky blue", "tropical blue",
    "sunshine yellow", "canary yellow", "lemon yellow",
    "bright pink", "bubblegum pink",
    # neon/lime family (already daytime-coded elsewhere; included so the
    # softener fires consistently even if _is_evening_item returns None)
    "lime", "lime green", "chartreuse",
    "neon green", "neon yellow", "neon pink", "neon orange", "bright yellow",
}

# Colours that are visually jarring in winter/fall even during daytime —
# a soft penalty is applied via the weather dimension.  Deliberately narrow:
# only the most saturated/fluorescent tones; earth-tone brights like rust,
# mustard, and burgundy are left unpenalised.
_WINTER_JARRING_COLORS: Set[str] = {
    "neon yellow", "neon green", "neon pink", "neon orange",
    "lime", "lime green", "chartreuse",
    "electric blue", "bright yellow", "canary yellow",
    "sunshine yellow", "lemon yellow", "hot pink", "fuchsia", "fluorescent",
}

# Style tags / descriptor tokens that EXPLICITLY signal daytime / beach character.
# Deliberately narrow: "lightweight", "vacation", "resort" are intentionally
# excluded because they appear in the descriptors of many non-summery items
# (lightweight wool blazer, vacation capsule wardrobe, resort-casual dress).
# Only use tokens that are unambiguously beach/summer-specific.
_SUMMERY_TOKENS: Set[str] = {
    "airy", "summery", "breezy", "tropical",
    "beach", "poolside",
    "flowy and light", "sun-ready",
}

# ── Pattern vocabulary ─────────────────────────────────────────────────────────
_SOLID_PATTERNS: Set[str]    = {"solid", "plain", "", "none"}
_BUSY_PATTERNS: Set[str]     = {
    "geometric", "tie-dye", "graphic", "abstract", "mosaic",
    "checkered", "plaid", "houndstooth", "mixed",
}
_ROMANTIC_PATTERNS: Set[str] = {"floral", "lace", "paisley", "ditsy", "botanical", "floral print"}
_BOLD_PATTERNS: Set[str]     = {
    "animal print", "leopard", "zebra", "snake", "geometric",
    "abstract", "color block", "tie-dye",
}

# ── Fit / silhouette vocabularies ─────────────────────────────────────────────
_STRUCTURED_FITS: Set[str]   = {"tailored", "fitted", "structured", "bodycon", "form-fitting"}
_RELAXED_FITS: Set[str]      = {"oversized", "baggy", "relaxed", "loose", "boxy"}
_FLOWY_FITS: Set[str]        = {"flowy", "a-line", "wrap", "bias-cut", "flared", "tiered"}


# ── Item attribute helpers ─────────────────────────────────────────────────────

def _item_fabric(item: Dict) -> str:
    desc = item.get("descriptors") or {}
    return (desc.get("fabric_type") or desc.get("fabric") or "").lower().strip()


def _item_fit(item: Dict) -> str:
    desc = item.get("descriptors") or {}
    return (desc.get("fit") or desc.get("silhouette") or "").lower().strip()


def _item_sleeve(item: Dict) -> str:
    desc = item.get("descriptors") or {}
    return (desc.get("sleeve_length") or desc.get("sleeve") or "").lower().strip()


def _item_type_str(item: Dict) -> str:
    return (item.get("item_type") or "").lower().strip()


def _item_pattern(item: Dict) -> str:
    return (item.get("pattern") or "").lower().strip()


def _item_color(item: Dict) -> str:
    return (item.get("color") or "").lower().strip()


def _item_formality(item: Dict) -> float:
    return float(item.get("formality_score") or NEUTRAL)


def _item_category(item: Dict) -> str:
    return (item.get("category") or "").lower().strip()


def _clamp(v: float) -> float:
    return max(0.0, min(1.0, v))


# Inline formality alignment (avoids circular import with recommender.py)
def _formality_alignment(item_f: float, event_f: float, tolerance: float = 0.25) -> float:
    diff = abs(item_f - event_f)
    if diff <= tolerance:
        return 1.0
    return max(0.0, 1.0 - (diff - tolerance) / (1.0 - tolerance))


# ─────────────────────────────────────────────────────────────────────────────
# Dimension 1: Dress Code (formality alignment)
# ─────────────────────────────────────────────────────────────────────────────

def _score_dim_dress_code(items: List[Dict], occasion: Dict) -> float:
    """
    Formality alignment between each item and the event's required dress code.
    Uses tighter tolerance (0.22 vs 0.25) for high-formality events (≥ 0.70)
    to gate out casually-coded items at cocktail/black-tie briefs.
    """
    event_formality = float(occasion.get("formality_level") or NEUTRAL)
    # Tighter tolerance at high formality
    tolerance = 0.22 if event_formality >= 0.70 else 0.25

    scores = [_formality_alignment(_item_formality(i), event_formality, tolerance) for i in items]
    return round(sum(scores) / len(scores), 4) if scores else NEUTRAL


# ─────────────────────────────────────────────────────────────────────────────
# Dimension 2: Mood (style mood / vibe alignment)
# ─────────────────────────────────────────────────────────────────────────────

def _mood_score_item(item: Dict, moods: Set[str]) -> float:
    """Score a single item against the set of detected event moods."""
    fabric    = _item_fabric(item)
    fit       = _item_fit(item)
    color     = _item_color(item)
    pattern   = _item_pattern(item)
    formality = _item_formality(item)
    style_tags: List[str] = [t.lower() for t in (item.get("style_tags") or [])]

    scores: List[float] = []

    if "elegant" in moods or "classic" in moods:
        s = 0.50
        if formality >= 0.65:                                      s += 0.25
        elif formality < 0.40:                                     s -= 0.22
        if fit in _STRUCTURED_FITS:                                s += 0.15
        elif fit in _RELAXED_FITS:                                 s -= 0.12
        if pattern in _SOLID_PATTERNS:                             s += 0.10
        elif pattern in _BUSY_PATTERNS:                            s -= 0.15
        if color in _NEUTRAL_COLORS or color in _DARK_RICH_COLORS: s += 0.05
        if any(t in style_tags for t in ("elegant", "classic", "refined", "polished")): s += 0.08
        scores.append(_clamp(s))

    if "romantic" in moods:
        s = 0.50
        if pattern in _ROMANTIC_PATTERNS:                          s += 0.25
        if fabric in {"chiffon", "silk", "lace", "satin"}:        s += 0.15
        if color in _ROMANTIC_COLORS:                              s += 0.15
        if fit in _FLOWY_FITS:                                     s += 0.10
        if any(t in style_tags for t in ("romantic", "feminine", "delicate")): s += 0.08
        scores.append(_clamp(s))

    if "bold" in moods or "sexy" in moods or "street smart" in moods:
        s = 0.50
        if color in _BOLD_COLORS:                                  s += 0.20
        if pattern in _BOLD_PATTERNS:                              s += 0.15
        if fit in {"bodycon", "mini", "cropped", "cutout", "asymmetric"}: s += 0.15
        if pattern in _SOLID_PATTERNS and color in _NEUTRAL_COLORS: s -= 0.10
        if any(t in style_tags for t in ("bold", "statement", "edgy", "sexy")): s += 0.08
        scores.append(_clamp(s))

    if "minimalist" in moods:
        s = 0.50
        if pattern in _SOLID_PATTERNS:                             s += 0.25
        if color in _NEUTRAL_COLORS:                               s += 0.15
        if pattern in _BUSY_PATTERNS or pattern in _ROMANTIC_PATTERNS: s -= 0.25
        if any(t in style_tags for t in ("minimal", "minimalist", "clean", "simple")): s += 0.08
        scores.append(_clamp(s))

    return round(sum(scores) / len(scores), 4) if scores else NEUTRAL


def _score_dim_mood(items: List[Dict], event_tokens: Set[str]) -> float:
    """Average mood alignment across all outfit items."""
    _MOOD_TOKENS: Set[str] = {
        "elegant", "classic", "romantic", "bold", "minimalist", "sexy", "street smart",
    }
    moods = _MOOD_TOKENS & event_tokens
    if not moods:
        return NEUTRAL

    scores = [_mood_score_item(i, moods) for i in items]
    return round(sum(scores) / len(scores), 4) if scores else NEUTRAL


# ─────────────────────────────────────────────────────────────────────────────
# Dimension 3: Time of Day
# ─────────────────────────────────────────────────────────────────────────────

def _is_evening_item(item: Dict) -> Optional[bool]:
    """
    Classify item as evening-coded (True), daytime-coded (False), or versatile (None).

    Signals checked in priority order:
      1. Fabric — velvet/satin/sequin → evening; linen/cotton/denim (low formality) → daytime
      2. Color  — summery/tropical/neon palette → daytime regardless of formality
      3. Style tags / descriptors — "airy", "summery", "tropical", etc. → daytime
      4. Season — summer-only item with moderate-or-lower formality → daytime
      5. Formality score — ≥ 0.70 → evening; (lower already caught above)
      6. Item type keywords — "cocktail"/"gown" → evening; "t-shirt"/"jeans" → daytime

    The key guarantee: a leather jacket or structured heel layered OVER a summery
    core piece cannot reclassify the outfit as evening-appropriate — the core
    garment's classification drives the time-of-day dimension score.
    """
    fabric    = _item_fabric(item)
    formality = _item_formality(item)
    itype     = _item_type_str(item)
    color     = _item_color(item)
    season    = (item.get("season") or "").lower()

    # 1. Fabric — strongest explicit signal
    if fabric in _EVENING_FABRICS:
        return True
    if fabric in _DAYTIME_FABRICS and formality < 0.38:
        return False

    # Pre-compute style tags + descriptor text (used by checks 2, 3, 4)
    style_tags: List[str] = [t.lower() for t in (item.get("style_tags") or [])]
    desc = item.get("descriptors") or {}
    desc_text = " ".join(str(v).lower() for v in desc.values() if v)
    tag_text  = " ".join(style_tags)
    combined  = f"{desc_text} {tag_text} {itype}"

    # 2. Color palette — neon / lime / chartreuse family are UNAMBIGUOUSLY daytime.
    # Require a confirming seasonal or descriptor signal for the color alone to
    # code an item as daytime — a neon or lime item that also reads "summer" or
    # "airy" is definitively daytime; the same color on a structured blazer without
    # those signals should remain versatile rather than being hard-coded daytime.
    is_summery_color = (
        color in _SUMMERY_COLORS
        or any(sc in color for sc in ("lime", "neon", "chartreuse"))
    )
    if is_summery_color:
        has_confirming_signal = (
            (season == "summer" and formality < 0.55)
            or any(tok in combined for tok in ("airy", "summery", "breezy", "tropical", "beach", "poolside"))
        )
        if has_confirming_signal:
            return False
        # Color alone without confirming signal → treat as versatile below

    # 3. Style tags and descriptor fields — explicit summery/beach tokens → daytime
    if any(tok in combined for tok in _SUMMERY_TOKENS):
        return False

    # 4. Season — summer-only items with moderate-or-lower formality → daytime
    if season == "summer" and formality < 0.55:
        return False

    # 5. Formality — high-formality items lean evening
    if formality >= 0.70:
        return True

    # 6. Item type keywords
    if any(k in itype for k in ("cocktail", "evening", "gown", "formal", "dinner")):
        return True
    if any(k in itype for k in ("t-shirt", "tank", "casual", "sundress", "jeans", "shorts", "hoodie")):
        return False

    return None  # versatile — neutral score


def _score_dim_time_of_day(items: List[Dict], event_tokens: Set[str], occasion: Dict) -> float:
    """
    Score outfit fitness for the event's time of day.

    Evening/nighttime events heavily penalise daytime-coded items (score 0.20).
    Daytime events are lenient about over-dressing (slight penalty vs hard fail).

    Core-garment cap (evening only):
    ─────────────────────────────────
    Outerwear, shoes, and accessories are "finishing layers" — they can elevate
    a neutral look but they cannot override a summery/daytime-coded MAIN garment.
    If any non-outerwear, non-shoe, non-accessory item is daytime-coded at an
    evening event the dimension score is capped at 0.30 (below TIME_VETO 0.35)
    so the hard veto fires and the outfit is eliminated.

    Example: lime-green airy co-ord set + leather jacket + heeled sandals.
    Without the cap the jacket and heels (both versatile → 0.72) pull the
    average above TIME_VETO even though the main piece is daytime-coded.
    The cap ensures the veto fires regardless of how good the outerwear is.

    Summer-evening vivid-colour softener:
    ──────────────────────────────────────
    When the event is both evening AND summer-temperature (warm/hot), versatile
    items in vivid tropical/bright colours are downgraded from 0.72 → 0.45.
    They are not hard-vetoed (richer tones in the right silhouette still work),
    but jewel/dark tones score meaningfully higher, pushing the recommender
    toward moodier, more evening-appropriate palettes for summer nights.
    """
    is_evening = bool({"evening", "nighttime"} & event_tokens)
    is_daytime = "daytime" in event_tokens

    if not is_evening and not is_daytime:
        return NEUTRAL

    # Season context — used by colour softeners and coverage nudges.
    temp_ctx = (occasion.get("temperature_context") or "").lower()
    is_summer_ctx       = temp_ctx in ("warm", "hot")
    is_transitional_ctx = temp_ctx in ("mild", "cool")   # spring / fall

    # Outerwear / shoes / accessories are "finishers", not main garments
    _FINISHER_CATS: Set[str] = {
        "outerwear", "shoes", "footwear",
        "accessories", "accessory", "jewelry", "bag",
    }

    scores: List[float] = []
    core_has_daytime_coded = False  # tracks whether a MAIN garment is day-coded

    for item in items:
        is_core  = _item_category(item) not in _FINISHER_CATS
        ev_coded = _is_evening_item(item)

        if is_evening:
            if ev_coded is True:
                scores.append(0.95)   # perfect evening piece
            elif ev_coded is None:
                # Summer-evening vivid-colour softener:
                # A plain coral sundress (no summery tags → versatile) should
                # not score as high as a jewel-toned midi at a summer night event.
                base = 0.72
                if is_summer_ctx and is_core:
                    color = _item_color(item)
                    if color in _SUMMER_VIVID_COLORS or any(
                        tok in color for tok in ("neon", "bright", "vivid", "tropical")
                    ):
                        base = 0.45   # down from versatile — not a veto, just a nudge
                scores.append(base)
            else:
                scores.append(0.20)   # daytime-coded at evening event
                if is_core:
                    core_has_daytime_coded = True

            # Spring / fall evening — sleeveless core items get a soft
            # coverage downgrade on top of their classification score.
            # A sleeveless satin top at an evening event scores 0.95 (correct
            # classification) but on a mild spring evening it's slightly
            # underdressed for the temperature — nudge it toward 0.80.
            # Does not apply to shoes/outerwear/accessories.
            if is_transitional_ctx and is_core and scores:
                sleeve = _item_sleeve(item)
                if sleeve in {"sleeveless", "cap", "strapless", "off-shoulder"}:
                    scores[-1] = min(scores[-1], 0.80)

        else:  # daytime
            if ev_coded is False:
                scores.append(0.95)   # perfect daytime piece
            elif ev_coded is None:
                scores.append(0.72)   # versatile — fine
            else:
                scores.append(0.62)   # slightly over-dressed but ok

    avg = round(sum(scores) / len(scores), 4) if scores else NEUTRAL

    # Cap below TIME_VETO when a core garment is daytime-coded at an evening event
    if is_evening and core_has_daytime_coded:
        avg = min(avg, 0.30)

    return avg


# ─────────────────────────────────────────────────────────────────────────────
# Dimension 4: Weather
# ─────────────────────────────────────────────────────────────────────────────

def _score_dim_weather(items: List[Dict], occasion: Dict) -> float:
    """
    Score outfit fabric and coverage fit against weather conditions.

    Reads from:
      - occasion["temperature_context"] — LLM-inferred "cold", "warm", etc.
      - occasion["raw_text_json"]["weather"] — explicit user selection ("Rainy", "Cold", …)
      - occasion["event_tokens"] — semantic tags for outdoor, evening, festive, etc.

    Handles the following contextual intersections beyond basic hot/cold/rain:

      Spring/fall evening:  mild or cool evenings favour light coverage; sleeveless
                            items are gently deprioritised and outerwear gets a bonus.

      Outdoor evening:      any evening held outdoors (rooftop, garden, terrace, etc.)
                            rewards outerwear and coverage regardless of season.

      Rainy-day colour:     wet conditions favour dark/muted tones; very light/white
                            items get a soft practical penalty (visible rain marks).

      Festive/holiday winter: red, gold, green, and white are seasonally appropriate
                            in holiday contexts — winter jarring-colour penalty is
                            suppressed for these hues.

      Cool summer night:    San-Francisco-style cool summer evenings warrant a light
                            layer even though the base season is summer.
    """
    temp_ctx = (occasion.get("temperature_context") or "").lower()
    raw_weather = ""
    rtj = occasion.get("raw_text_json") or {}
    if rtj:
        raw_weather = str(rtj.get("weather") or "").lower()
    weather_text = f"{temp_ctx} {raw_weather}".strip()

    event_tokens: Set[str] = {
        str(t).lower().strip()
        for t in (occasion.get("event_tokens") or [])
        if str(t).strip()
    }

    is_rainy = any(w in weather_text for w in ("rain", "rainy", "drizzle", "wet", "storm"))
    is_cold  = any(w in weather_text for w in ("cold", "cool", "chilly", "freezing"))
    is_hot   = any(w in weather_text for w in ("hot", "warm", "humid", "heat"))
    is_mild  = temp_ctx in ("mild", "indoor", "outdoor") and not is_cold and not is_hot

    # ── Contextual flags derived from token intersections ──────────────────────
    is_evening_event = bool({"evening", "nighttime"} & event_tokens)

    # Outdoor settings where temperature actually matters even in the evening
    is_outdoor = bool({
        "outdoor", "outside", "rooftop", "garden", "terrace", "alfresco",
        "park", "beach", "outdoor concert", "festival", "open air",
    } & event_tokens)

    # Festive/holiday context where seasonal colours (red/gold/green/white) are appropriate
    is_festive = bool({
        "festive", "holiday", "christmas", "new year", "new year's eve",
        "thanksgiving", "hanukkah", "diwali", "celebration",
    } & event_tokens)

    # "Cool summer" — explicitly signalled chilly summer evening (e.g. SF, coastal)
    is_cool_summer = is_hot and bool({
        "slightly cool", "cool evening", "cooler tonight", "bring a layer",
        "cool summer", "cool coastal", "breezy evening",
    } & event_tokens)

    # Mild + evening context (spring/fall evening needing light coverage)
    is_mild_evening = is_evening_event and (is_mild or temp_ctx == "cool")

    if not is_rainy and not is_cold and not is_hot and not is_mild:
        return NEUTRAL

    scores: List[float] = []
    for item in items:
        fabric    = _item_fabric(item)
        category  = _item_category(item)
        sleeve    = _item_sleeve(item)
        season    = (item.get("season") or "all").lower()
        color     = _item_color(item)
        desc      = item.get("descriptors") or {}
        shoe_type = (desc.get("shoe_type") or "").lower()
        is_core   = category not in {
            "outerwear", "shoes", "footwear", "accessories", "accessory", "jewelry", "bag"
        }

        s = 0.50

        # ── Rainy conditions ──────────────────────────────────────────────────
        if is_rainy:
            if fabric in _DELICATE_FABRICS:                                       s -= 0.25
            if category == "shoes" and any(
                k in shoe_type for k in ("sandal", "slide", "flip", "open")
            ):
                s -= 0.30
            if category == "outerwear":                                           s += 0.20
            if season == "summer":                                                s -= 0.10
            # Practical tonal nudge: very pale/white items show water marks and
            # feel visually flat in grey rainy light — prefer muted/darker tones.
            if is_core and color in {"white", "ivory", "cream", "off-white", "ecru"}:
                s -= 0.08

        # ── Cold / cool conditions ────────────────────────────────────────────
        if is_cold:
            if fabric in _HEAVY_FABRICS:                                          s += 0.25
            if category == "outerwear":                                           s += 0.20
            if sleeve in {"sleeveless", "cap", "strapless", "off-shoulder"}:     s -= 0.22
            if fabric in _BREATHABLE_FABRICS and fabric not in {"silk", "satin"}: s -= 0.10
            if season == "summer":                                                s -= 0.15
            # Winter/cold tonal penalty — jarring fluorescent/neon colours feel
            # out of season in cold weather even during daytime.
            # Exception: festive/holiday colours (red, gold, green, white) are
            # seasonally appropriate and are intentionally excluded from this list.
            if is_core and not is_festive:
                if color in _WINTER_JARRING_COLORS or any(
                    tok in color for tok in ("neon", "fluorescent", "lime", "chartreuse")
                ):
                    s -= 0.12   # tonal mismatch nudge

        # ── Hot / warm conditions ─────────────────────────────────────────────
        if is_hot:
            if fabric in _BREATHABLE_FABRICS:                                     s += 0.20
            if fabric in _HEAVY_FABRICS:                                          s -= 0.22
            if sleeve in {"sleeveless", "short", "cap"}:                          s += 0.10
            if category == "outerwear" and fabric in _HEAVY_FABRICS:             s -= 0.25
            # Cool-summer override: when it's technically summer but the evening
            # is chilly (e.g. coastal), reward light layers rather than penalising them.
            if is_cool_summer:
                if category == "outerwear" and fabric not in _HEAVY_FABRICS:     s += 0.18
                if sleeve in {"long", "3/4"}:                                     s += 0.08

        # ── Spring / fall mild evening — light-coverage nudge ─────────────────
        # A sleeveless look on a mild spring/fall evening is slightly underdressed
        # for temperature comfort.  Outerwear and longer sleeves get a bonus.
        # Does not apply to indoor events (temperature controlled).
        if is_mild_evening and not is_outdoor or (is_mild_evening and is_outdoor):
            # Apply regardless of indoor/outdoor — spring/fall evenings are cool
            if sleeve in {"sleeveless", "cap"} and is_core:                       s -= 0.10
            if category == "outerwear":                                           s += 0.14
            if sleeve in {"long", "3/4"} and is_core:                            s += 0.06

        # ── Outdoor evening — outerwear bonus (all seasons) ───────────────────
        # Any evening outdoors benefits from a layer, even in summer.
        # Stacks with the mild-evening nudge above for spring/fall outdoor nights.
        if is_outdoor and is_evening_event and not is_mild_evening:
            # Already handled in mild_evening block; skip double-counting.
            if category == "outerwear":                                           s += 0.10

        scores.append(_clamp(s))

    if not scores:
        return NEUTRAL

    # Mild-only events that don't trigger rainy/cold/hot still return a score.
    return round(sum(scores) / len(scores), 4)


# ─────────────────────────────────────────────────────────────────────────────
# Dimension 5: Purpose
# ─────────────────────────────────────────────────────────────────────────────

def _score_dim_purpose(items: List[Dict], event_tokens: Set[str]) -> float:
    """
    Score outfit appropriateness for the stated event purpose.

    Date night / dinner: rewards polished formality range (0.55–0.90).
    Party:              more latitude — rewards festive and bold.
    Work event:         rewards professional range (0.50–0.85).
    """
    _PURPOSE_TOKENS: Set[str] = {
        "date night", "date", "dinner", "party", "work event",
        "vacation", "wedding guest", "concert", "brunch", "networking",
    }
    detected = _PURPOSE_TOKENS & event_tokens
    if not detected:
        return NEUTRAL

    is_date_night = bool({"date night", "date", "romantic"} & detected)
    is_dinner     = "dinner" in detected
    is_party      = "party" in detected
    is_work       = bool({"work event", "colleagues", "clients", "networking"} & detected)

    scores: List[float] = []
    for item in items:
        formality = _item_formality(item)
        fabric    = _item_fabric(item)
        category  = _item_category(item)
        s = 0.50

        if is_date_night or is_dinner:
            # Polished range — reward elegant, penalise too casual or too formal
            if 0.55 <= formality <= 0.90:    s += 0.28
            elif 0.40 <= formality < 0.55:   s += 0.10
            elif formality < 0.35:           s -= 0.22
            if fabric in _EVENING_FABRICS:   s += 0.10
            if category == "loungewear":     s -= 0.30

        if is_party:
            if formality >= 0.40:            s += 0.15
            if fabric in _EVENING_FABRICS:   s += 0.10
            if category == "loungewear":     s -= 0.15

        if is_work:
            if 0.50 <= formality <= 0.85:    s += 0.22
            elif formality < 0.35:           s -= 0.25
            if category in {"loungewear", "swimwear"}: s -= 0.30

        scores.append(_clamp(s))

    return round(sum(scores) / len(scores), 4) if scores else NEUTRAL


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────

def score_event_appropriate(
    items: List[Dict[str, Any]],
    occasion: Dict[str, Any],
) -> Tuple[float, Dict[str, float], str]:
    """
    Multi-dimensional event alignment scorer.

    Args:
        items:    Outfit items (wardrobe item dicts with formality_score,
                  category, descriptors, color, pattern, season, style_tags…)
        occasion: Event/occasion dict with formality_level, temperature_context,
                  event_tokens, and optionally raw_text_json.

    Returns:
        composite_score  — 0.0 if hard-vetoed; else weighted dim average [0, 1]
        dim_scores       — per-dimension scores for outfit card explainability
        label            — human-readable summary string
    """
    if not items:
        return NEUTRAL, {d: NEUTRAL for d in _DIM_WEIGHTS}, "no items to score"

    event_tokens: Set[str] = {
        str(t).lower().strip()
        for t in (occasion.get("event_tokens") or [])
        if str(t).strip()
    }

    # ── Score each dimension ────────────────────────────────────────────────
    dim_scores: Dict[str, float] = {
        "dress_code":  _score_dim_dress_code(items, occasion),
        "mood":        _score_dim_mood(items, event_tokens),
        "time_of_day": _score_dim_time_of_day(items, event_tokens, occasion),
        "weather":     _score_dim_weather(items, occasion),
        "purpose":     _score_dim_purpose(items, event_tokens),
    }

    # ── Hard veto rule 1: Dress code fundamentally misaligned ──────────────
    # A casual item at a cocktail event cannot be saved by a good color story.
    if dim_scores["dress_code"] < VETO_THRESHOLD:
        logger.debug(
            "event_appropriate: HARD VETO (dress_code) — score=%.3f < %.2f",
            dim_scores["dress_code"], VETO_THRESHOLD,
        )
        return 0.0, dim_scores, "eliminated: dress code mismatch"

    # ── Hard veto rule 2: Wrong time of day (when explicitly specified) ─────
    # Only fires when the brief contains a time signal — prevents over-penalising
    # events where the user left time-of-day blank.
    has_time_signal = bool({"evening", "nighttime", "daytime"} & event_tokens)
    if has_time_signal and dim_scores["time_of_day"] < TIME_VETO:
        logger.debug(
            "event_appropriate: HARD VETO (time_of_day) — score=%.3f < %.2f",
            dim_scores["time_of_day"], TIME_VETO,
        )
        return 0.0, dim_scores, "eliminated: wrong time of day coding"

    # ── Weighted composite ──────────────────────────────────────────────────
    composite = sum(_DIM_WEIGHTS[d] * dim_scores[d] for d in _DIM_WEIGHTS)
    composite = round(_clamp(composite), 4)

    # ── Label ───────────────────────────────────────────────────────────────
    if composite >= 0.82:
        label = "strong event match"
    elif composite >= 0.68:
        label = "good event alignment"
    elif composite >= 0.52:
        label = "partial event match"
    else:
        label = "weak event alignment"

    logger.debug(
        "event_appropriate: composite=%.3f dims=%s label=%s",
        composite, dim_scores, label,
    )
    return composite, dim_scores, label
