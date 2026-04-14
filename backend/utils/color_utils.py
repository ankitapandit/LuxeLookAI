"""
utils/color_utils.py — Hex-to-name colour normalisation
========================================================
Converts any CSS hex colour code (#RRGGBB or #RGB) to a human-readable
name before it is stored in the database or passed to any LLM prompt.

Strategy:
  1. If the value is already a plain word (no '#') → return as-is.
  2. Try webcolors.hex_to_name() for an exact CSS3 / CSS21 match.
  3. On ValueError (no exact match) → find the perceptually closest
     CSS3 name by minimising Euclidean distance in RGB space.
  4. Map a handful of verbose CSS3 names to shorter fashion-friendly
     equivalents (e.g. "darkslategray" → "dark slate grey").

The result is always a lower-case plain-English word or short phrase —
never a hex code.
"""

from __future__ import annotations
import re
import math
from typing import Optional
import webcolors


# ─── Fashion-friendly name overrides ──────────────────────────────────────────
# CSS3 names that are too technical or verbose for a styling context.
_FRIENDLY_NAMES: dict[str, str] = {
    "darkseagreen":         "dark sea green",
    "darkslategray":        "dark slate grey",
    "darkslategrey":        "dark slate grey",
    "lightslategray":       "light slate grey",
    "lightslategrey":       "light slate grey",
    "mediumslateblue":      "slate blue",
    "lightsteelblue":       "steel blue",
    "cadetblue":            "steel blue",
    "darkturquoise":        "teal",
    "mediumturquoise":      "teal",
    "lightseagreen":        "teal",
    "darkcyan":             "teal",
    "mediumaquamarine":     "aqua",
    "aquamarine":           "aqua",
    "paleturquoise":        "light blue",
    "powderblue":           "light blue",
    "lightblue":            "light blue",
    "cornflowerblue":       "cornflower blue",
    "royalblue":            "royal blue",
    "dodgerblue":           "bright blue",
    "deepskyblue":          "sky blue",
    "lightskyblue":         "sky blue",
    "steelblue":            "steel blue",
    "midnightblue":         "midnight blue",
    "darkblue":             "dark blue",
    "navyblue":             "navy",
    "navy":                 "navy",
    "mediumblue":           "blue",
    "slateblue":            "slate blue",
    "blueviolet":           "blue violet",
    "mediumpurple":         "medium purple",
    "darkorchid":           "orchid",
    "mediumorchid":         "orchid",
    "darkviolet":           "dark violet",
    "darkmagenta":          "magenta",
    "indigo":               "indigo",
    "rebeccapurple":        "purple",
    "mediumvioletred":      "deep rose",
    "palevioletred":        "dusty rose",
    "hotpink":              "hot pink",
    "deeppink":             "deep pink",
    "lightpink":            "light pink",
    "mistyrose":            "blush",
    "lavenderblush":        "blush",
    "lavender":             "lavender",
    "thistle":              "lavender",
    "plum":                 "plum",
    "violet":               "violet",
    "orchid":               "orchid",
    "crimson":              "crimson",
    "firebrick":            "deep red",
    "darkred":              "dark red",
    "indianred":            "rose",
    "lightsalmon":          "light salmon",
    "salmon":               "salmon",
    "darksalmon":           "salmon",
    "tomato":               "tomato red",
    "orangered":            "orange red",
    "coral":                "coral",
    "darkorange":           "dark orange",
    "peachpuff":            "peach",
    "bisque":               "peach",
    "moccasin":             "peach",
    "papayawhip":           "cream",
    "lemonchiffon":         "light yellow",
    "lightyellow":          "light yellow",
    "cornsilk":             "cream",
    "ivory":                "ivory",
    "floralwhite":          "off white",
    "antiquewhite":         "off white",
    "oldlace":              "off white",
    "linen":                "linen",
    "seashell":             "off white",
    "whitesmoke":           "light grey",
    "gainsboro":            "light grey",
    "lightgrey":            "light grey",
    "lightgray":            "light grey",
    "silver":               "silver",
    "darkgray":             "dark grey",
    "darkgrey":             "dark grey",
    "dimgray":              "charcoal",
    "dimgrey":              "charcoal",
    "grey":                 "grey",
    "gray":                 "grey",
    "slategray":            "slate grey",
    "slategrey":            "slate grey",
    "darkkhaki":            "khaki",
    "khaki":                "khaki",
    "palegoldenrod":        "light gold",
    "goldenrod":            "gold",
    "darkgoldenrod":        "dark gold",
    "burlywood":            "tan",
    "wheat":                "wheat",
    "tan":                  "tan",
    "sandybrown":           "sandy brown",
    "peru":                 "tan",
    "chocolate":            "chocolate brown",
    "saddlebrown":          "dark brown",
    "sienna":               "sienna",
    "rosybrown":            "dusty rose",
    "maroon":               "maroon",
    "darkgreen":            "dark green",
    "forestgreen":          "forest green",
    "seagreen":             "sea green",
    "mediumseagreen":       "sea green",
    "limegreen":            "lime green",
    "lime":                 "lime",
    "lawngreen":            "lime green",
    "chartreuse":           "lime green",
    "greenyellow":          "yellow green",
    "yellowgreen":          "yellow green",
    "olivedrab":            "olive",
    "olive":                "olive",
    "darkolivegreen":       "dark olive",
    "palegreen":            "light green",
    "lightgreen":           "light green",
    "springgreen":          "mint green",
    "mediumspringgreen":    "mint green",
    "mintcream":            "mint",
    "honeydew":             "mint",
    "azure":                "light blue",
    "aliceblue":            "light blue",
    "ghostwhite":           "off white",
    "snow":                 "off white",
    "beige":                "beige",
    "blanchedalmond":       "cream",
    "navajowhite":          "peach",
    "gold":                 "gold",
    "yellow":               "yellow",
    "orange":               "orange",
    "red":                  "red",
    "blue":                 "blue",
    "green":                "green",
    "black":                "black",
    "white":                "white",
    "pink":                 "pink",
    "purple":               "purple",
    "brown":                "brown",
    "cyan":                 "cyan",
    "magenta":              "magenta",
    "teal":                 "teal",
}


# ─── Regex for detecting hex colour strings ────────────────────────────────────
_HEX_PATTERN = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def _expand_hex(hex_str: str) -> str:
    """Normalise to full 6-digit lowercase hex with leading #."""
    h = hex_str.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return f"#{h.lower()}"


def _nearest_css3_name(hex_color: str) -> str:
    """
    Find the CSS3 colour name whose RGB value is closest to hex_color
    using Euclidean distance in RGB space.
    """
    try:
        target = webcolors.hex_to_rgb(hex_color)
    except ValueError:
        return "unknown"

    min_dist  = float("inf")
    best_name = "unknown"

    for name in webcolors.names("css3"):
        try:
            rgb = webcolors.name_to_rgb(name)
            dist = math.sqrt(
                (target.red   - rgb.red)   ** 2 +
                (target.green - rgb.green) ** 2 +
                (target.blue  - rgb.blue)  ** 2
            )
            if dist < min_dist:
                min_dist  = dist
                best_name = name
        except ValueError:
            continue

    return best_name


def hex_to_color_name(value: str) -> str:
    """
    Convert a hex colour code to a human-readable fashion name.

    Args:
        value: Either a hex string (e.g. '#245761', '245761', '#fff')
               or an already-named colour (e.g. 'navy', 'beige').
               Any non-hex string is returned unchanged (lowercased).

    Returns:
        Lower-case plain-English colour name. Never a hex code.

    Examples:
        hex_to_color_name('#245761')  → 'dark slate grey'
        hex_to_color_name('#FF6B6B')  → 'salmon'
        hex_to_color_name('navy')     → 'navy'
        hex_to_color_name('#fff')     → 'white'
    """
    if not value:
        return value

    stripped = value.strip()

    # Already a plain word — not a hex code
    if not _HEX_PATTERN.match(stripped):
        return stripped.lower()

    full_hex = _expand_hex(stripped)

    # Try exact CSS3 match first
    try:
        css_name = webcolors.hex_to_name(full_hex, spec="css3")
    except ValueError:
        css_name = _nearest_css3_name(full_hex)

    return _FRIENDLY_NAMES.get(css_name, css_name.replace("-", " "))


def normalize_color(value: Optional[str]) -> Optional[str]:
    """
    Normalise a colour value for storage and display.

    Wraps hex_to_color_name() with None-safety.
    Call this whenever a user-supplied colour is stored or passed to an LLM.
    """
    if not value:
        return value
    return hex_to_color_name(value)


def color_family(value: Optional[str]) -> Optional[str]:
    """
    Map a normalized colour name to a broader colour family.

    This is intentionally conservative and is mainly used for duplicate
    detection, where we want nearby shades to count as the same range
    (e.g. navy / blue, blush / pink) without collapsing obviously different
    colours together.
    """
    normalized = normalize_color(value)
    if not normalized:
        return normalized

    name = normalized.lower().strip()

    family_keywords: list[tuple[str, tuple[str, ...]]] = [
        ("multicolor", ("multicolor", "multi color", "multi-colour", "multi colour", "colorblock", "colourblock", "rainbow")),
        ("black", ("black", "charcoal", "onyx", "jet")),
        ("white", ("white", "ivory", "cream", "off white", "snow")),
        ("grey", ("grey", "gray", "silver", "slate")),
        ("blue", ("blue", "navy", "indigo", "teal", "cyan", "aqua")),
        ("green", ("green", "olive", "mint", "sage", "lime")),
        ("red", ("red", "crimson", "scarlet", "maroon", "burgundy", "wine")),
        ("pink", ("pink", "rose", "blush")),
        ("orange", ("orange", "coral", "peach", "apricot", "rust", "terracotta", "burnt orange")),
        ("yellow", ("yellow", "gold", "khaki", "mustard")),
        ("brown", ("brown", "tan", "beige", "camel", "taupe", "sienna", "wheat", "sand", "stone", "mocha", "chocolate")),
        ("purple", ("purple", "violet", "lavender", "plum", "orchid", "magenta")),
    ]

    for family, keywords in family_keywords:
        if any(keyword in name for keyword in keywords):
            return family

    return name


def same_color_family(a: Optional[str], b: Optional[str]) -> bool:
    """Return True when two colour values belong to the same broad colour range."""
    family_a = color_family(a)
    family_b = color_family(b)
    if not family_a or not family_b:
        return False
    return family_a == family_b
