/**
 * pages/wardrobe.tsx — Wardrobe management page
 *
 * Review panel asks user ONLY: category, color, pattern.
 * Season + formality are AI-only — never shown to user.
 *
 * Color section:
 *   - Preset swatches (excluding "pattern")
 *   - Eyedropper: click image → canvas samples the pixel → sets custom hex
 *   - Custom hex input fallback
 *
 * Pattern section (separate from color):
 *   - Pattern is captured via the descriptor picker (pattern attribute per category)
 *   - Dropdown with pattern name + inline SVG swatch preview
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import Head from "next/head";
import Image from "next/image";
import Navbar from "@/components/layout/Navbar";
import {
  tagPreview, uploadClothingItem, getTagOptions, correctItem,
  deleteClothingItem, getWardrobeItemsPage, getDeletedItems, restoreClothingItem,
  getWardrobeMediaStatus, TagPreview, TagOptions, ClothingItem,
} from "@/services/api";
import { AlertCircle, Upload, Archive, ShirtIcon, Loader, CheckCircle, Pencil, X, Pipette, RotateCcw } from "lucide-react";
import toast from "react-hot-toast";

// Maps any color value → a human-readable name.
// For preset keys ("black", "navy") returns the label directly.
// For custom hex values, finds the nearest preset color by RGB distance.
function resolveColorName(color: string): string {
  if (!color) return "";
  // Preset key → label
  const preset = SOLID_COLORS.find(c => c.key === color);
  if (preset) return preset.label;
  if (color === "pattern") return "Pattern";
  // Custom hex → nearest preset by Euclidean RGB distance
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    let nearest = SOLID_COLORS[0];
    let minDist = Infinity;
    for (const c of SOLID_COLORS) {
      const pr = parseInt(c.hex.slice(1, 3), 16);
      const pg = parseInt(c.hex.slice(3, 5), 16);
      const pb = parseInt(c.hex.slice(5, 7), 16);
      const dist = Math.sqrt((r-pr)**2 + (g-pg)**2 + (b-pb)**2);
      if (dist < minDist) { minDist = dist; nearest = c; }
    }
    return `~${nearest.label}`;  // ~ prefix signals it's approximate
  }
  return color;
}

// Maps any stored color name back to the nearest SOLID_COLORS key so the
// correct swatch is highlighted in the edit modal for existing items.
function normalizeToPresetKey(color: string): string | null {
  if (!color) return null;
  if (color.startsWith("#")) return null; // custom hex — no swatch match
  if (SOLID_COLORS.some(c => c.key === color)) return color;
  const lower = color.toLowerCase();
  // Explicit overrides for common normalized names
  const overrides: Record<string, string> = {
    "charcoal": "black", "ebony": "black", "jet black": "black", "onyx": "black",
    "ivory": "white", "off white": "white", "cream": "white", "snow": "white",
    "midnight blue": "navy", "dark blue": "navy", "indigo": "navy", "slate blue": "navy",
    "camel": "beige", "tan": "beige", "khaki": "beige", "sand": "beige", "wheat": "beige",
    "sandybrown": "beige", "sandy brown": "beige",
    "crimson": "red", "scarlet": "red", "maroon": "red", "burgundy": "red",
    "deep red": "red", "dark red": "red", "tomato red": "red",
    "sage": "green", "olive": "green", "forest green": "green", "dark green": "green",
    "lime green": "green", "lime": "green", "sea green": "green", "mint green": "green",
    "dark grey": "grey", "light grey": "grey", "silver": "grey",
    "slate grey": "grey", "dark slate grey": "grey", "light slate grey": "grey",
    "charcoal grey": "grey",
    "chocolate brown": "brown", "dark brown": "brown", "sienna": "brown",
    "blush": "pink", "dusty rose": "pink", "hot pink": "pink", "light pink": "pink",
    "deep pink": "pink", "rose": "pink", "deep rose": "pink",
    "sky blue": "blue", "light blue": "blue", "steel blue": "blue", "royal blue": "blue",
    "cornflower blue": "blue", "bright blue": "blue", "teal": "blue", "cyan": "blue",
    "light yellow": "yellow", "gold": "yellow",
    "dark orange": "orange", "peach": "orange", "coral": "orange",
    "dark violet": "purple", "plum": "purple", "violet": "purple",
    "orchid": "purple", "lavender": "purple", "magenta": "purple",
  };
  if (overrides[lower]) return overrides[lower];
  // Substring fallback: if color name contains a key (e.g. "dark blue" → "blue")
  for (const c of [...SOLID_COLORS].sort((a, b) => b.key.length - a.key.length)) {
    if (lower.includes(c.key)) return c.key;
  }
  return null;
}

function getCurrentSeason(date: Date = new Date()): string {
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "fall";
  return "winter";
}

function getSeasonLabel(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isCompatibleSeasonPair(a: string, b: string): boolean {
  const seasonA = (a || "").toLowerCase().trim();
  const seasonB = (b || "").toLowerCase().trim();
  if (!seasonA || !seasonB) return false;
  if (seasonA === "all" || seasonB === "all") return true;
  if (seasonA === seasonB) return true;

  const warm = new Set(["spring", "summer"]);
  const cool = new Set(["fall", "winter"]);
  return (warm.has(seasonA) && warm.has(seasonB)) || (cool.has(seasonA) && cool.has(seasonB));
}

// ── Preset solid colors (pattern removed — handled separately) ────────────────
const SOLID_COLORS: { key: string; hex: string; label: string }[] = [
  { key: "black",  hex: "#1a1a1a", label: "Black"  },
  { key: "white",  hex: "#f5f5f0", label: "White"  },
  { key: "navy",   hex: "#1e2f5e", label: "Navy"   },
  { key: "beige",  hex: "#c8a97e", label: "Beige"  },
  { key: "red",    hex: "#c0392b", label: "Red"    },
  { key: "green",  hex: "#4a7c59", label: "Green"  },
  { key: "grey",   hex: "#9e9e9e", label: "Grey"   },
  { key: "brown",  hex: "#7d5a3c", label: "Brown"  },
  { key: "pink",   hex: "#e8a0a0", label: "Pink"   },
  { key: "blue",   hex: "#4a90c4", label: "Blue"   },
  { key: "yellow", hex: "#d4a843", label: "Yellow" },
  { key: "orange", hex: "#d4703a", label: "Orange" },
  { key: "purple", hex: "#7c5cbf", label: "Purple" },
];

// Map key → hex for item card display
const COLOR_HEX: Record<string, string> = Object.fromEntries(
  SOLID_COLORS.map(c => [c.key, c.hex])
);

// ── Pattern definitions with inline SVG renders ───────────────────────────────
const PATTERNS: { key: string; label: string; svg: string }[] = [
  {
    key: "stripes",
    label: "Stripes",
    svg: `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#f0ece4"/>
      <line x1="0" y1="8"  x2="40" y2="8"  stroke="#333" stroke-width="4"/>
      <line x1="0" y1="20" x2="40" y2="20" stroke="#333" stroke-width="4"/>
      <line x1="0" y1="32" x2="40" y2="32" stroke="#333" stroke-width="4"/>
    </svg>`,
  },
  {
    key: "plaid",
    label: "Plaid / Tartan",
    svg: `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#e8d5c4"/>
      <line x1="0" y1="10" x2="40" y2="10" stroke="#8B3A3A" stroke-width="3"/>
      <line x1="0" y1="30" x2="40" y2="30" stroke="#8B3A3A" stroke-width="3"/>
      <line x1="10" y1="0" x2="10" y2="40" stroke="#8B3A3A" stroke-width="3"/>
      <line x1="30" y1="0" x2="30" y2="40" stroke="#8B3A3A" stroke-width="3"/>
      <line x1="0" y1="20" x2="40" y2="20" stroke="#3A5C8B" stroke-width="1.5"/>
      <line x1="20" y1="0" x2="20" y2="40" stroke="#3A5C8B" stroke-width="1.5"/>
    </svg>`,
  },
  {
    key: "floral",
    label: "Floral",
    svg: `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#f5e8f0"/>
      <circle cx="10" cy="10" r="4" fill="#e07090" opacity="0.8"/>
      <circle cx="10" cy="10" r="2" fill="#fff"/>
      <circle cx="30" cy="10" r="3" fill="#c060a0" opacity="0.8"/>
      <circle cx="30" cy="10" r="1.5" fill="#fff"/>
      <circle cx="20" cy="25" r="5" fill="#e07090" opacity="0.7"/>
      <circle cx="20" cy="25" r="2.5" fill="#fff"/>
      <circle cx="8"  cy="32" r="3" fill="#d07898" opacity="0.6"/>
      <circle cx="35" cy="32" r="4" fill="#c060a0" opacity="0.8"/>
      <circle cx="35" cy="32" r="2" fill="#fff"/>
    </svg>`,
  },
  {
    key: "polka_dots",
    label: "Polka Dots",
    svg: `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#f0ece4"/>
      <circle cx="10" cy="10" r="4" fill="#333"/>
      <circle cx="30" cy="10" r="4" fill="#333"/>
      <circle cx="20" cy="22" r="4" fill="#333"/>
      <circle cx="10" cy="34" r="4" fill="#333"/>
      <circle cx="30" cy="34" r="4" fill="#333"/>
    </svg>`,
  },
  {
    key: "animal_print",
    label: "Animal Print",
    svg: `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#e8c87a"/>
      <ellipse cx="10" cy="10" rx="5" ry="3" fill="#6b4c11" opacity="0.7"/>
      <ellipse cx="25" cy="7"  rx="4" ry="2.5" fill="#6b4c11" opacity="0.7"/>
      <ellipse cx="35" cy="18" rx="3" ry="5" fill="#6b4c11" opacity="0.7"/>
      <ellipse cx="15" cy="26" rx="5" ry="3" fill="#6b4c11" opacity="0.7"/>
      <ellipse cx="32" cy="33" rx="4" ry="3" fill="#6b4c11" opacity="0.7"/>
      <ellipse cx="6"  cy="34" rx="3" ry="4" fill="#6b4c11" opacity="0.7"/>
    </svg>`,
  },
  {
    key: "geometric",
    label: "Geometric",
    svg: `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#e8e4dc"/>
      <polygon points="20,2 38,38 2,38" fill="none" stroke="#333" stroke-width="2"/>
      <rect x="8" y="8" width="12" height="12" fill="none" stroke="#999" stroke-width="1.5" transform="rotate(15,14,14)"/>
      <polygon points="26,14 38,14 32,26" fill="#ccc" opacity="0.6"/>
    </svg>`,
  },
  {
    key: "abstract",
    label: "Abstract / Other print",
    svg: `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#e4eaf0"/>
      <path d="M5 20 Q15 5 25 20 Q35 35 40 15" stroke="#4a7cb0" stroke-width="3" fill="none"/>
      <path d="M0 30 Q10 15 20 28 Q30 42 40 25" stroke="#b06a4a" stroke-width="2.5" fill="none"/>
      <circle cx="8" cy="8" r="3" fill="#7cb04a" opacity="0.7"/>
      <circle cx="32" cy="32" r="4" fill="#b04a7c" opacity="0.6"/>
    </svg>`,
  },
];

const FABRIC_OPTIONS = [
  "cotton",
  "polyester",
  "nylon",
  "spandex",
  "elastane",
  "rayon",
  "linen",
  "denim",
  "satin",
  "silk",
  "chiffon",
  "mesh",
  "lace",
  "knit",
  "wool",
  "leather",
  "suede",
  "faux fur",
  "tweed",
  "jersey",
  "terry",
  "lycra",
  "recycled nylon",
  "fleece",
  "modal",
  "bamboo",
  "waffle-knit",
] as const;

const CATEGORY_DESCRIPTORS: Record<string, Record<string, string[]>> = {
  // ── Tops ────────────────────────────────────────────────────────────────────
  tops: {
    fabric_type:   [...FABRIC_OPTIONS],
    neckline:      ["crew","round","V-neck","square","scoop","sweetheart","off-shoulder",
                    "halter","high neck","turtleneck","collar","cowl","asymmetrical"],
    sleeve_length: ["sleeveless","cap","short","3/4","long"],
    sleeve_style:  ["puff","bishop","balloon","bell","raglan","batwing","cold shoulder","flutter"],
    fit:           ["slim","regular","relaxed","loose","oversized","bodycon",
                    "tailored","A-line","fit & flare","wrap"],
    length:        ["crop","regular","longline"],
    closure:       ["pullover","button-front","zip-up","wrap","open front"],
    hemline:       ["straight","curved","asymmetrical","high-low","peplum","ruffle hem"],
    strap_type:    ["strapless","spaghetti","wide","adjustable","racerback","cross-back","halter"],
    back_style:    ["open back","low back","keyhole","strappy","tie-back","zipper back"],
    detailing:     ["ruffles","pleats","ruched","smocked","tiered","draped",
                    "cut-out","slit","bow","knot","lace-up","fringe","embroidery"],
    elasticity:    ["non-stretch","slight stretch","medium stretch","high stretch"],
    sheer:         ["opaque","semi-sheer","sheer"],
    pattern:       ["solid","floral","striped","graphic","abstract","tie-dye","plaid","animal print"],
  },
  // ── Dresses ─────────────────────────────────────────────────────────────────
  dresses: {
    fabric_type:   [...FABRIC_OPTIONS],
    neckline:      ["crew","round","V-neck","square","scoop","sweetheart","off-shoulder",
                    "halter","high neck","turtleneck","collar","cowl","asymmetrical"],
    sleeve_length: ["sleeveless","cap","short","3/4","long"],
    sleeve_style:  ["puff","bishop","balloon","bell","raglan","batwing","cold shoulder","flutter"],
    fit:           ["slim","regular","relaxed","loose","oversized","bodycon",
                    "tailored","A-line","fit & flare","wrap"],
    length:        ["crop","regular","longline","mini","midi","maxi"],
    closure:       ["pullover","button-front","zip-up","wrap","open front"],
    hemline:       ["straight","curved","asymmetrical","high-low","peplum","ruffle hem"],
    strap_type:    ["strapless","spaghetti","wide","adjustable","racerback","cross-back","halter"],
    back_style:    ["open back","low back","keyhole","strappy","tie-back","zipper back"],
    detailing:     ["ruffles","pleats","ruched","smocked","tiered","draped",
                    "cut-out","slit","bow","knot","lace-up","fringe","embroidery"],
    elasticity:    ["non-stretch","slight stretch","medium stretch","high stretch"],
    sheer:         ["opaque","semi-sheer","sheer"],
    pattern:       ["solid","floral","striped","graphic","abstract","tie-dye","plaid","animal print"],
  },
  // ── Jumpsuits / Rompers ───────────────────────────────────────────────────
  jumpsuits: {
    fabric_type:    [...FABRIC_OPTIONS],
    jumpsuit_style: ["tailored","utility","romper","playsuit","halter","strapless","boiler","evening","boho","wide-leg","straight-leg","tapered"],
    neckline:       ["crew","round","V-neck","square","scoop","sweetheart","off-shoulder",
                     "halter","high neck","turtleneck","collar","cowl","asymmetrical"],
    sleeve_length:  ["sleeveless","cap","short","3/4","long"],
    sleeve_style:   ["puff","bishop","balloon","bell","raglan","batwing","cold shoulder","flutter"],
    strap_type:     ["strapless","spaghetti","wide","adjustable","racerback","cross-back","halter"],
    fit:            ["slim","regular","relaxed","loose","oversized","bodycon",
                     "tailored","A-line","fit & flare","wrap","belted"],
    length:         ["short","cropped","ankle","full-length"],
    leg_shape:      ["shorts","straight","wide-leg","tapered","flared","culotte"],
    waist_structure:["elastic","drawstring","belted","paperbag","corset","smocked"],
    closure:        ["pullover","button-front","zip-up","wrap","open front"],
    detailing:      ["ruffles","pleats","ruched","smocked","tiered","draped",
                     "cut-out","slit","bow","knot","lace-up","fringe","embroidery"],
    elasticity:     ["non-stretch","slight stretch","medium stretch","high stretch"],
    sheer:          ["opaque","semi-sheer","sheer"],
    pattern:        ["solid","floral","striped","graphic","abstract","tie-dye","plaid","animal print"],
  },
  // ── Outerwear ───────────────────────────────────────────────────────────────
  outerwear: {
    outerwear_type:     ["blazer","jacket","coat","trench","cardigan","bomber","puffer","shacket","cape","vest"],
    fabric_type:        [...FABRIC_OPTIONS],
    collar_style:       ["notched","shawl","mandarin","spread","stand","funnel","hooded","lapel-free"],
    sleeve_length:      ["sleeveless","cap","short","3/4","long"],
    sleeve_style:       ["raglan","drop shoulder","set-in","batwing","cuffed","quilted"],
    fit:                ["tailored","slim","regular","relaxed","boxy","oversized"],
    length:             ["cropped","waist","hip","thigh","knee","midi","longline"],
    closure:            ["open front","single-breasted","double-breasted","zip-up","toggle","belted","snap"],
    hemline:            ["straight","curved","asymmetrical","split hem"],
    detailing:          ["quilted","belted","epaulettes","contrast trim","patch pockets","ribbed cuffs","shearling trim"],
    pattern:            ["solid","floral","striped","graphic","abstract","tie-dye","plaid","animal print"],
    insulation:         ["lightweight","midweight","heavyweight","insulated","down-filled"],
    weather_resistance: ["water-resistant","waterproof","windproof"],
  },
  // ── Bottoms ─────────────────────────────────────────────────────────────────
  bottoms: {
    fabric_type:     [...FABRIC_OPTIONS],
    waist_position:  ["high","mid","low","drop","empire"],
    waist_structure: ["elastic","drawstring","belted","paperbag","corset"],
    fit:             ["slim","straight","relaxed","loose","wide-leg","flared"],
    leg_opening:     ["skinny","straight","wide","flare","bootcut","tapered","barrel"],
    length:          ["shorts","mini","midi","maxi","capri","ankle","full-length"],
    distressing:     ["clean","distressed","ripped","frayed","washed"],
    elasticity:      ["non-stretch","slight stretch","medium stretch","high stretch"],
    sheer:           ["opaque","semi-sheer"],
    pattern:         ["solid","plaid","striped","floral"],
  },
  // ── Shoes ───────────────────────────────────────────────────────────────────
  shoes: {
    shoe_type:   ["heels","sneakers","sandals","boots","flats","loafers",
                  "pumps","mules","platforms","mary janes"],
    toe_shape:   ["round","pointed","square","open-toe","peep-toe"],
    heel_height: ["flat","low","mid","high","platform"],
    heel_type:   ["stiletto","block","wedge","kitten","cone","spool","chunky","sculptural"],
    closure:     ["slip-on","lace-up","buckle","zip","velcro","strappy"],
    fit:         ["regular","wide","narrow"],
    material:    ["leather","suede","canvas","synthetic","fabric"],
    pattern:     ["solid","animal print","textured","colorblock"],
  },
  // ── Accessories ─────────────────────────────────────────────────────────────
  accessories: {
    accessory_type: ["handbag","tote","clutch","backpack","crossbody","belt",
                     "scarf","hat","sunglasses","jewelry","watch"],
    size:           ["mini","small","medium","large","oversized"],
    material:       ["leather","fabric","straw","metal","synthetic"],
    style:          ["structured","slouchy","minimalist","embellished","logo"],
    closure:        ["zipper","magnetic","snap","drawstring"],
    strap_type:     ["top handle","crossbody","shoulder","chain"],
  },
};

const COMMON_DESCRIPTORS: Record<string, string[]> = {};  // all attributes are now per-category
const PAGE_SIZE = 12;
const CATEGORY_FILTER_OPTIONS = [
  "tops",
  "bottoms",
  "dresses",
  "jumpsuits",
  "outerwear",
  "shoes",
  "accessories",
  "set",
  "swimwear",
  "loungewear",
];

function shouldBypassImageOptimization(src: string): boolean {
  return src.startsWith("blob:") || src.startsWith("data:");
}

function mergeDescriptorGroups(...groups: Array<Record<string, string[]>>): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const group of groups) {
    for (const [key, values] of Object.entries(group)) {
      merged[key] = Array.from(new Set([...(merged[key] || []), ...values]));
    }
  }
  return merged;
}

function prefixDescriptorGroups(
  groups: Record<string, string[]>,
  prefix: string
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(groups).map(([key, values]) => [`${prefix}_${key}`, values])
  );
}

function formatDescriptorLabel(key: string): string {
  return key.replace(/_/g, " ");
}

function getDescriptorGroupLabel(key: string): string {
  if (key.startsWith("top_")) return `Top ${formatDescriptorLabel(key.slice(4))}`;
  if (key.startsWith("bottom_")) return `Bottom ${formatDescriptorLabel(key.slice(7))}`;
  return formatDescriptorLabel(key);
}

function getDescriptorOptionsForCategory(
  category: string,
  existingDescriptors: Record<string, string> = {}
): Record<string, string[]> {
  const catKey = category.toLowerCase().replace(/\s+/g, "");
  if (catKey === "set") {
    const merged = mergeDescriptorGroups(
      prefixDescriptorGroups(CATEGORY_DESCRIPTORS.tops || {}, "top"),
      prefixDescriptorGroups(CATEGORY_DESCRIPTORS.bottoms || {}, "bottom"),
      COMMON_DESCRIPTORS
    );

    for (const [key, value] of Object.entries(existingDescriptors)) {
      if (!value) continue;
      merged[key] = Array.from(new Set([...(merged[key] || []), value]));
    }

    return merged;
  }

  const aliasMap: Record<string, string[]> = {
    loungewear: ["tops", "bottoms"],
    swimwear: ["tops", "bottoms", "dresses"],
  };

  const categoryGroups = aliasMap[catKey]?.length
    ? aliasMap[catKey].map(key => CATEGORY_DESCRIPTORS[key] || {})
    : [CATEGORY_DESCRIPTORS[catKey] || {}];

  const merged = mergeDescriptorGroups(...categoryGroups, COMMON_DESCRIPTORS);

  for (const [key, value] of Object.entries(existingDescriptors)) {
    if (!value) continue;
    merged[key] = Array.from(new Set([...(merged[key] || []), value]));
  }

  return merged;
}

function mergeUniqueIds(current: string[], incoming: string[]): string[] {
  return Array.from(new Set([...current, ...incoming]));
}

function isTrackableMediaStatus(status?: ClothingItem["media_status"]): boolean {
  return status === "pending" || status === "processing";
}

function isVisibleMediaStatus(status?: ClothingItem["media_status"]): boolean {
  return status === "pending" || status === "processing" || status === "failed";
}

function getMediaStatusLabel(item: ClothingItem): string {
  if (item.media_status === "failed") {
    return item.media_error ? `Processing failed: ${item.media_error}` : "Processing failed";
  }
  if (item.media_status === "pending") return "Queued for processing";
  if (item.media_stage === "thumbnail") return "Generating quick preview";
  if (item.media_stage === "cutout") return "Extracting subject";
  return "Processing media";
}

function getMediaBadgeLabel(item: ClothingItem): string | null {
  if (item.media_status === "failed") return "Processing failed";
  if (item.media_status === "pending") return "Queued";
  if (item.media_status === "processing") {
    return item.media_stage === "cutout" ? "Extracting subject" : "Processing";
  }
  return null;
}



// ═══════════════════════════════════════════════════════════════════════════════
// Page component
// ═══════════════════════════════════════════════════════════════════════════════

export default function WardrobePage() {
  const [items,        setItems]        = useState<ClothingItem[]>([]);
  const [totalCount,   setTotalCount]   = useState(0);
  const [deletedItems, setDeletedItems] = useState<ClothingItem[]>([]);
  const [showTrash,    setShowTrash]    = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [hasMore,      setHasMore]      = useState(true);
  const [loadingTrash, setLoadingTrash] = useState(false);
  const [deletedLoaded, setDeletedLoaded] = useState(false);
  const [loadingTagOptions, setLoadingTagOptions] = useState(false);
  const [tagOptionsLoaded, setTagOptionsLoaded] = useState(false);
  const [tagOptions,   setTagOptions]   = useState<TagOptions>({ categories: [], colors: [], seasons: [], formality_levels: [] });
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // Upload wizard state
  const [pendingFile,    setPendingFile]    = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [aiTags,         setAiTags]         = useState<TagPreview | null>(null);
  const [correctedCat,   setCorrectedCat]   = useState<string>("");
  const [correctedColor, setCorrectedColor] = useState<string>("");  // color key or custom hex
  const [step,           setStep]           = useState<"idle"|"analysing"|"review"|"saving">("idle");
  const [filterCat,       setFilterCat]       = useState("all");
  const [filterSeason,    setFilterSeason]    = useState("all");
  const [filterFormality, setFilterFormality] = useState("all");
  const [descriptors, setDescriptors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<TagPreview["duplicate"]>(null);
  const [editingItem, setEditingItem] = useState<ClothingItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<ClothingItem | null>(null);
  const [archiveAfterSave, setArchiveAfterSave] = useState(false);
  const [trackedMediaIds, setTrackedMediaIds] = useState<string[]>([]);
  const [mediaActivity, setMediaActivity] = useState<Record<string, ClothingItem>>({});
  const [activityExpanded, setActivityExpanded] = useState(false);

  const hasActiveFilters = filterCat !== "all" || filterSeason !== "all" || filterFormality !== "all";

  const registerMediaItems = useCallback((nextItems: ClothingItem[]) => {
    const relevant = nextItems.filter((item) => isVisibleMediaStatus(item.media_status));
    if (!relevant.length) return;
    setMediaActivity((prev) => {
      const merged = { ...prev };
      for (const item of relevant) merged[item.id] = item;
      return merged;
    });
    setTrackedMediaIds((prev) =>
      mergeUniqueIds(
        prev,
        relevant.filter((item) => isTrackableMediaStatus(item.media_status)).map((item) => item.id)
      )
    );
  }, []);

  const loadWardrobePage = useCallback(async (reset: boolean, offsetOverride?: number) => {
    const offset = reset ? 0 : (offsetOverride ?? 0);
    if (reset) setLoading(true);
    else setLoadingMore(true);

    try {
      const result = await getWardrobeItemsPage({
        limit: PAGE_SIZE,
        offset,
        category: filterCat !== "all" ? filterCat : undefined,
        season: filterSeason !== "all" ? filterSeason : undefined,
        formality: filterFormality !== "all" ? filterFormality : undefined,
      });

      setItems(prev => reset ? result.items : [...prev, ...result.items]);
      setHasMore(result.has_more);
      setTotalCount(result.total_count);
      registerMediaItems(result.items);
    } catch {
      toast.error("Failed to load wardrobe");
    } finally {
      if (reset) setLoading(false);
      else setLoadingMore(false);
    }
  }, [filterCat, filterFormality, filterSeason, registerMediaItems]);

  const ensureTagOptions = useCallback(async () => {
    if (tagOptionsLoaded || loadingTagOptions) return;
    setLoadingTagOptions(true);
    try {
      const opts = await getTagOptions();
      setTagOptions(opts);
      setTagOptionsLoaded(true);
    } catch {
      toast.error("Failed to load wardrobe options");
    } finally {
      setLoadingTagOptions(false);
    }
  }, [loadingTagOptions, tagOptionsLoaded]);

  const loadTrashItems = useCallback(async () => {
    if (deletedLoaded || loadingTrash) return;
    setLoadingTrash(true);
    try {
      const deleted = await getDeletedItems();
      setDeletedItems(deleted);
      setDeletedLoaded(true);
    } catch {
      toast.error("Failed to load archived items");
    } finally {
      setLoadingTrash(false);
    }
  }, [deletedLoaded, loadingTrash]);

  const addUploadedItem = useCallback((item: ClothingItem) => {
    setTotalCount((prev) => prev + 1);
    const matchesFilters =
      (filterCat === "all" || item.category === filterCat) &&
      (filterSeason === "all" || item.season === filterSeason || item.season === "all") &&
      (filterFormality === "all" || formalityBucket(item.formality_score) === filterFormality);
    if (matchesFilters) {
      setItems((prev) => [item, ...prev]);
    }
    registerMediaItems([item]);
  }, [filterCat, filterFormality, filterSeason, registerMediaItems]);

  useEffect(() => {
    void loadWardrobePage(true, 0);
  }, [loadWardrobePage]);

  useEffect(() => {
    if (step === "review") void ensureTagOptions();
  }, [ensureTagOptions, step]);

  useEffect(() => {
    if (showTrash) void loadTrashItems();
  }, [loadTrashItems, showTrash]);

  useEffect(() => {
    void loadTrashItems();
  }, [loadTrashItems]);

  const loadMoreItems = useCallback(() => {
    if (loading || loadingMore || !hasMore || showTrash) return;
    void loadWardrobePage(false, items.length);
  }, [hasMore, items.length, loadWardrobePage, loading, loadingMore, showTrash]);

  const handleTrashToggle = useCallback(() => {
    const next = !showTrash;
    setShowTrash(next);
    if (next) void loadTrashItems();
  }, [loadTrashItems, showTrash]);

  useEffect(() => {
    if (!loadMoreRef.current || loading || loadingMore || !hasMore || showTrash) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreItems();
      },
      { rootMargin: "200px 0px" }
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadMoreItems, loading, loadingMore, showTrash]);

  useEffect(() => {
    if (!trackedMediaIds.length) return;

    let cancelled = false;
    const trackedIds = [...trackedMediaIds];

    async function pollMediaStatus() {
      try {
        const updates = await getWardrobeMediaStatus(trackedIds);
        if (cancelled) return;

        const byId = new Map(updates.map((item) => [item.id, item]));
        setItems((prev) => prev.map((item) => {
          const update = byId.get(item.id);
          return update ? { ...item, ...update } : item;
        }));
        setDeletedItems((prev) => prev.map((item) => {
          const update = byId.get(item.id);
          return update ? { ...item, ...update } : item;
        }));
        setMediaActivity((prev) => {
          const next = { ...prev };
          for (const id of trackedIds) {
            const update = byId.get(id);
            if (!update) continue;
            if (update.media_status === "ready") delete next[id];
            else next[id] = update;
          }
          return next;
        });

        const terminalIds = updates
          .filter((item) => item.media_status === "ready" || item.media_status === "failed")
          .map((item) => item.id);

        if (terminalIds.length) {
          setTrackedMediaIds((prev) => prev.filter((id) => !terminalIds.includes(id)));
        }
      } catch {
        // Keep the tray optimistic; the next poll can recover.
      }
    }

    void pollMediaStatus();
    const interval = window.setInterval(pollMediaStatus, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [trackedMediaIds]);

  const resetWizard = useCallback(() => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null); setPendingPreview(null); setAiTags(null);
    setCorrectedCat(""); setCorrectedColor(""); setStep("idle");
    setDescriptors({});
    setDuplicate(null);
    setArchiveAfterSave(false);
  }, [pendingPreview]);

  const onDrop = useCallback(async (accepted: File[]) => {
    const file = accepted[0];
    if (!file) return;
    setPendingFile(file);
    setPendingPreview(URL.createObjectURL(file));
    setStep("analysing");
    try {
      const tags = await tagPreview(file);
      void ensureTagOptions();
      setAiTags(tags);
      setCorrectedCat(tags.category);
      setCorrectedColor(tags.color);
      setDescriptors(tags.descriptors || {});
      setDuplicate(tags.duplicate || null);
      setStep("review");
    } catch {
      toast.error("AI tagging failed — please try again");
      resetWizard();
    }
  }, [ensureTagOptions, resetWizard]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { "image/*": [".jpg",".jpeg",".png",".webp"] },
    multiple: false, disabled: step !== "idle",
  });

  async function handleConfirm() {
    if (!pendingFile || !aiTags) return;
    setStep("saving");
    try {
      const newItem = await uploadClothingItem(pendingFile, {
        category: correctedCat   !== aiTags.category ? correctedCat   : undefined,
        color:    correctedColor  !== aiTags.color   ? correctedColor  : undefined,
        descriptors: Object.keys(descriptors).length > 0 ? descriptors : undefined,
      });
      const detectedSeason = (newItem.season || "").toLowerCase().trim();
      const currentSeason = getCurrentSeason();
      const seasonMismatch = !!detectedSeason && !isCompatibleSeasonPair(detectedSeason, currentSeason);

      if (seasonMismatch && archiveAfterSave) {
        try {
          await deleteClothingItem(newItem.id);
          const archivedOn = new Date().toISOString();
          setDeletedItems((prev) => [{
            ...newItem,
            is_active: false,
            is_archived: true,
            archived_on: archivedOn,
            deleted_at: archivedOn,
          }, ...prev.filter((entry) => entry.id !== newItem.id)]);
          toast.success("Saved and moved to Archived");
        } catch {
          addUploadedItem(newItem);
          toast.error("Saved to wardrobe, but could not move it to Archived");
        }
      } else {
        addUploadedItem(newItem);
        toast.success("Item added to wardrobe!");
      }
    } catch {
      toast.error("Upload failed — please try again");
    } finally { resetWizard(); }
  }

  async function handleCorrect(itemId: string, category: string, color: string, pattern: string, descriptors: Record<string, string>) {
    try {
      const updated = await correctItem(itemId, { category, color, pattern: pattern || undefined, descriptors: Object.keys(descriptors).length > 0 ? descriptors : undefined });
      const matchesFilters =
        (filterCat === "all" || updated.category === filterCat) &&
        (filterSeason === "all" || updated.season === filterSeason || updated.season === "all") &&
        (filterFormality === "all" || formalityBucket(updated.formality_score) === filterFormality);
      setItems(prev => {
        if (!matchesFilters) return prev.filter(i => i.id !== itemId);
        return prev.map(i => i.id === itemId ? { ...i, ...updated } : i);
      });
      toast.success("Updated!");
    } catch { toast.error("Could not update item"); }
  }

  async function handleDelete(itemId: string) {
    try {
      await deleteClothingItem(itemId);
      const removed = items.find(i => i.id === itemId);
      setItems(prev => prev.filter(i => i.id !== itemId));
      setTrackedMediaIds(prev => prev.filter(id => id !== itemId));
      setMediaActivity(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setTotalCount(prev => Math.max(0, prev - 1));
      if (removed) {
        const archivedOn = new Date().toISOString();
        setDeletedItems(prev => [{
          ...removed,
          is_active: false,
          is_archived: true,
          archived_on: archivedOn,
          deleted_at: archivedOn,
        }, ...prev]);
      }
      toast.success("Moved to Archived — restore any time");
    } catch { toast.error("Could not remove item"); }
  }

  async function handleRestore(itemId: string) {
    try {
      const status = await restoreClothingItem(itemId);
      // Remove from archived view in all success cases
      setDeletedItems(prev => prev.filter(i => i.id !== itemId));
      if (status === "restored") {
        await loadWardrobePage(true, 0);
        toast.success("Item restored to wardrobe");
      } else if (status === "auto_purged") {
        // Item was superseded by a newer active version — already in wardrobe
        toast("A newer version of this item is already in your wardrobe — old copy removed", {
          icon: "ℹ️",
          duration: 4000,
        });
      }
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { detail?: string } } };
      if (e?.response?.status === 409) {
        toast.error(
          "A similar item is already in your wardrobe. Remove it first if you want to restore this one.",
          { duration: 5000 }
        );
      } else {
        toast.error("Could not restore item");
      }
    }
  }

  const categoryFilters = CATEGORY_FILTER_OPTIONS;

  // Helper: map formality_score to the same bucket label used in the filter
  function formalityBucket(score: number | undefined): string {
    if (score === undefined || score === null) return "";
    if (score >= 0.75) return "Formal";
    if (score >= 0.50) return "Smart casual";
    if (score >= 0.25) return "Casual";
    return "Loungewear";
  }

  function clearFilters() {
    setFilterCat("all");
    setFilterSeason("all");
    setFilterFormality("all");
  }

  const activeFilterSummary = [
    filterCat !== "all" ? `Type: ${filterCat}` : null,
    filterSeason !== "all" ? `Season: ${filterSeason}` : null,
    filterFormality !== "all" ? `Dress code: ${filterFormality}` : null,
  ].filter(Boolean).join(" · ");

  function openEditModal(item: ClothingItem) {
    setEditingItem(item);
    void ensureTagOptions();
  }

  function openDeleteDialog(item: ClothingItem) {
    setDeletingItem(item);
  }

  const activityItems = Object.values(mediaActivity).sort((a, b) =>
    (b.media_updated_at || b.created_at).localeCompare(a.media_updated_at || a.created_at)
  );
  const activeActivityCount = activityItems.filter((item) => item.media_status !== "failed").length;

  return (
    <>
      <Head><title>Wardrobe — LuxeLook AI</title></Head>
      <Navbar />
      <main className="page-main" style={{ maxWidth: "1200px", margin: "0 auto", padding: "48px 24px" }}>

        <div style={{ marginBottom: "36px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h1 className="type-page-title" style={{ fontSize: "36px", marginBottom: "8px" }}>My Wardrobe</h1>
            <p className="type-body" style={{ color: "var(--muted)", fontSize: "15px" }}>
              {totalCount} item{totalCount === 1 ? "" : "s"} in your wardrobe · Clothing auto detect
            </p>
          </div>
          <button
              onClick={handleTrashToggle}
              style={{
                display: "flex", alignItems: "center", gap: "7px",
                padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--border)",
                background: showTrash ? "rgba(212,169,106,0.12)" : "transparent",
                color: showTrash ? "var(--gold)" : "var(--muted)",
                fontSize: "13px", fontWeight: 500, cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <Archive size={14} />
              {showTrash
                ? "← Back to Wardrobe"
                : deletedLoaded || deletedItems.length > 0
                  ? `Archived (${deletedItems.length})`
                  : "Archived"}
            </button>
        </div>

        {step === "idle" && (
          <div {...getRootProps()} className={`dropzone ${isDragActive ? "active" : ""}`} style={{ marginBottom: "32px" }}>
            <input {...getInputProps()} />
            <Upload size={28} color="var(--gold)" />
            <p style={{ fontWeight: 500, color: "var(--charcoal)", marginTop: "8px" }}>
                    {isDragActive ? "Drop your image here" : "Drag & drop a clothing photo"}
                  </p>
            <p className="type-helper" style={{ color: "var(--muted)", fontSize: "13px", marginTop: "4px" }}>
              or click to browse · one at a time
            </p>
          </div>
        )}

        {step === "analysing" && pendingPreview && (
          <div className="card fade-up" style={{ display: "flex", gap: "20px", padding: "24px", marginBottom: "32px", alignItems: "center" }}>
            <ManagedImage
              src={pendingPreview}
              alt="Pending clothing preview"
              width={90}
              height={120}
              sizes="90px"
              style={{ objectFit: "cover", borderRadius: "8px" }}
            />
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                <Loader size={18} color="var(--gold)" style={{ animation: "spin 1s linear infinite" }} />
                <p style={{ fontWeight: 600 }}>AI is analysing your item…</p>
              </div>
            <p className="type-helper" style={{ color: "var(--muted)", fontSize: "14px" }}>Detecting category and colour</p>
            </div>
          </div>
        )}

        {step === "review" && aiTags && pendingPreview && (
          <ReviewPanel
            previewUrl={pendingPreview}
            aiTags={aiTags}
            tagOptions={tagOptions}
            tagOptionsLoading={loadingTagOptions}
            correctedCat={correctedCat}
            correctedColor={correctedColor}
            descriptors={descriptors}
            duplicate={duplicate}
            seasonWarning={
              aiTags.season && !isCompatibleSeasonPair(aiTags.season, getCurrentSeason())
                ? `This looks more like a ${getSeasonLabel(aiTags.season)} piece than a ${getSeasonLabel(getCurrentSeason())} wardrobe.`
                : null
            }
            archiveAfterSave={archiveAfterSave}
            onCatChange={setCorrectedCat}
            onColorChange={setCorrectedColor}
            onDescriptorChange={(key, val) =>
              setDescriptors((prev: Record<string, string>) => ({ ...prev, [key]: val }))}
            onReplaceExisting={async () => {
              if (!duplicate) return;
              await handleDelete(duplicate.id);
              setDuplicate(null);
              handleConfirm();
            }}
            onKeepBoth={() => setDuplicate(null)}
            onArchiveAfterSaveChange={setArchiveAfterSave}
            onConfirm={handleConfirm}
            onCancel={resetWizard}
          />
        )}

        {step === "saving" && (
          <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
            <Loader size={28} color="var(--gold)" style={{ animation: "spin 1s linear infinite", display: "block", margin: "0 auto 12px" }} />
            Saving to your wardrobe…
          </div>
        )}

        {showTrash ? (
          /* ── Archived view ─────────────────────────────────────────────── */
          <div>
            <p className="type-body" style={{ color: "var(--muted)", fontSize: "14px", marginBottom: "20px" }}>
              Archived items are hidden from outfit suggestions. Restore them to bring them back.
            </p>
            {loadingTrash ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <Loader size={24} color="var(--gold)" style={{ animation: "spin 1s linear infinite", display: "block", margin: "0 auto 12px" }} />
                <p className="type-helper" style={{ color: "var(--muted)", fontSize: "13px" }}>Loading archived items…</p>
              </div>
            ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "16px" }}>
              {deletedItems.map(item => (
                <div key={item.id} className="card" style={{ padding: "0", overflow: "hidden", opacity: 0.75 }}>
                  {item.image_url && (
                    <div style={{ width: "100%", aspectRatio: "3/4", position: "relative" }}>
                      <ManagedImage
                        src={item.thumbnail_url || item.image_url}
                        alt={item.category}
                        fallbackSrc={`https://placehold.co/300x400/F5F0E8/8A8580?text=${encodeURIComponent(item.category)}`}
                        fill
                        sizes="(max-width: 768px) 50vw, 180px"
                        style={{ objectFit: "cover" }}
                      />
                    </div>
                  )}
                  <div style={{ padding: "12px" }}>
                    <p style={{ fontSize: "13px", fontWeight: 600, textTransform: "capitalize", marginBottom: "2px" }}>
                      {item.category}
                    </p>
                    <p style={{ fontSize: "12px", color: "var(--muted)", textTransform: "capitalize", marginBottom: "12px" }}>
                      {item.color || "—"}
                    </p>
                    <button
                      onClick={() => handleRestore(item.id)}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                        gap: "6px", padding: "7px 0", borderRadius: "6px",
                        border: "1px solid var(--gold)", background: "transparent",
                        color: "var(--gold)", fontSize: "13px", fontWeight: 500, cursor: "pointer",
                      }}
                    >
                      <RotateCcw size={13} /> Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>
        ) : (
          /* ── Active wardrobe view ─────────────────────────────────────── */
          <>
            {items.length > 0 && (
              <div className="wardrobe-filter-bar" style={{
                display: "flex", alignItems: "flex-start",
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: "14px", padding: "14px 20px",
                marginBottom: "28px", gap: "0", flexWrap: "wrap", overflowX: "visible", rowGap: "16px",
              }}>

                {/* Type */}
                <div style={{ flex: "1 1 350px", minWidth: "280px", paddingRight: "20px" }}>
                  <p className="type-micro" style={{ fontSize: "10px", fontWeight: 700, color: "var(--gold)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>Type</p>
                  <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                    {["all", ...categoryFilters].map(cat => (
                      <button key={cat} onClick={() => setFilterCat(cat)} style={{
                        padding: "4px 12px", borderRadius: "20px", fontSize: "12px",
                        fontWeight: filterCat === cat ? 600 : 400, cursor: "pointer",
                        border: `1px solid ${filterCat === cat ? "var(--charcoal)" : "var(--border)"}`,
                        background: filterCat === cat ? "var(--charcoal)" : "transparent",
                        color: filterCat === cat ? "var(--cream)" : "var(--muted)",
                        textTransform: "capitalize", transition: "all 0.15s ease",
                      }} className="type-chip">{cat === "all" ? "All" : cat}</button>
                    ))}
                  </div>
                </div>

                {/* Divider */}
                <div className="wardrobe-filter-divider" style={{ width: "1px", background: "var(--border)", alignSelf: "stretch", margin: "0 4px" }} />

                {/* Season */}
                <div style={{ flex: "1 1 300px", minWidth: "240px", paddingLeft: "20px", paddingRight: "20px" }}>
                  <p className="type-micro" style={{ fontSize: "10px", fontWeight: 700, color: "var(--gold)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>Season</p>
                  <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                    {["all", "spring", "summer", "fall", "winter"].map(s => (
                      <button key={s} onClick={() => setFilterSeason(s)} style={{
                        padding: "4px 12px", borderRadius: "20px", fontSize: "12px",
                        fontWeight: filterSeason === s ? 600 : 400, cursor: "pointer",
                        border: `1px solid ${filterSeason === s ? "var(--charcoal)" : "var(--border)"}`,
                        background: filterSeason === s ? "var(--charcoal)" : "transparent",
                        color: filterSeason === s ? "var(--cream)" : "var(--muted)",
                        textTransform: "capitalize", transition: "all 0.15s ease",
                      }} className="type-chip">{s === "all" ? "All" : s}</button>
                    ))}
                  </div>
                </div>

                {/* Divider */}
                <div className="wardrobe-filter-divider" style={{ width: "1px", background: "var(--border)", alignSelf: "stretch", margin: "0 4px" }} />

                {/* Dress code */}
                <div style={{ flex: "1 1 350px", minWidth: "280px", paddingLeft: "20px" }}>
                  <p className="type-micro" style={{ fontSize: "10px", fontWeight: 700, color: "var(--gold)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>Dress code</p>
                  <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                    {["all", "Loungewear", "Casual", "Smart casual", "Formal"].map(f => (
                      <button key={f} onClick={() => setFilterFormality(f)} style={{
                        padding: "4px 12px", borderRadius: "20px", fontSize: "12px",
                        fontWeight: filterFormality === f ? 600 : 400, cursor: "pointer",
                        border: `1px solid ${filterFormality === f ? "var(--charcoal)" : "var(--border)"}`,
                        background: filterFormality === f ? "var(--charcoal)" : "transparent",
                        color: filterFormality === f ? "var(--cream)" : "var(--muted)",
                        transition: "all 0.15s ease",
                      }} className="type-chip">{f === "all" ? "Any" : f}</button>
                    ))}
                  </div>
                </div>

              </div>
            )}

            {items.length > 0 && hasActiveFilters && (
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                flexWrap: "wrap",
                marginBottom: "20px",
              }}>
                <p className="type-helper" style={{ fontSize: "13px", color: "var(--muted)", margin: 0 }}>
                  Showing filtered results
                  {activeFilterSummary ? ` · ${activeFilterSummary}` : ""}
                </p>
                <button
                  className="btn-secondary"
                  onClick={clearFilters}
                  style={{ padding: "8px 14px", fontSize: "12px" }}
                >
                  Clear filters
                </button>
              </div>
            )}

            {loading ? (
              <div style={{ textAlign: "center", padding: "60px" }}>
                <Loader
                  size={32}
                  color="var(--gold)"
                  style={{ animation: "spin 1s linear infinite", display: "block", margin: "0 auto" }}
                />
              </div>
            ) : items.length === 0 && step === "idle" ? (
              hasActiveFilters
                ? <FilteredEmptyState onClear={clearFilters} />
                : <EmptyState />
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "20px" }}>
                  {items.map((item, index) => (
                    <ItemCard key={item.id} item={item} priority={index < 4}
                      onEdit={() => openEditModal(item)}
                      onRequestDelete={() => openDeleteDialog(item)}
                    />
                  ))}
                </div>
                {(hasMore || loadingMore) && (
                  <div ref={loadMoreRef} style={{ padding: "28px 0 8px", textAlign: "center" }}>
                    {loadingMore ? (
                      <Loader size={24} color="var(--gold)" style={{ animation: "spin 1s linear infinite", display: "block", margin: "0 auto 10px" }} />
                    ) : null}
                    {hasMore && !loadingMore ? (
                      <button className="btn-secondary" onClick={loadMoreItems} style={{ fontSize: "13px" }}>
                        Load more
                      </button>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
      {editingItem && (
        <ItemEditModal
          item={editingItem}
          tagOptions={tagOptions}
          tagOptionsLoading={loadingTagOptions}
          onRequestTagOptions={ensureTagOptions}
          onClose={() => setEditingItem(null)}
          onSave={(cat, color, pattern, nextDescriptors) => {
            void handleCorrect(editingItem.id, cat, color, pattern, nextDescriptors);
            setEditingItem(null);
          }}
        />
      )}
      {deletingItem && (
        <DeleteItemDialog
          item={deletingItem}
          onClose={() => setDeletingItem(null)}
          onConfirm={() => {
            void handleDelete(deletingItem.id);
            setDeletingItem(null);
          }}
        />
      )}
      {activityItems.length > 0 && (
        <div style={{
          position: "fixed",
          right: "24px",
          bottom: "24px",
          zIndex: 950,
          width: "min(360px, calc(100vw - 32px))",
          borderRadius: "16px",
          border: "1px solid var(--border)",
          background: "rgba(24,23,20,0.96)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
          backdropFilter: "blur(14px)",
        }}>
          <button
            onClick={() => setActivityExpanded((prev) => !prev)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              padding: "14px 16px",
              border: "none",
              background: "transparent",
              color: "var(--cream)",
              cursor: "pointer",
            }}
          >
            <div style={{ textAlign: "left" }}>
              <p style={{ fontSize: "13px", fontWeight: 600, marginBottom: "3px" }}>
                Wardrobe activity
              </p>
              <p style={{ fontSize: "12px", color: "rgba(244,238,228,0.72)" }}>
                {activeActivityCount > 0
                  ? `${activeActivityCount} upload${activeActivityCount === 1 ? "" : "s"} still processing`
                  : "Uploads need attention"}
              </p>
            </div>
            <span style={{ fontSize: "12px", color: "rgba(244,238,228,0.72)", flexShrink: 0 }}>
              {activityExpanded ? "Minimize" : "Show"}
            </span>
          </button>

          {activityExpanded && (
            <div style={{
              padding: "0 10px 10px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              maxHeight: "min(360px, 50vh)",
              overflowY: "auto",
            }}>
              {activityItems.map((item) => {
                const isFailed = item.media_status === "failed";
                return (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px",
                      borderRadius: "12px",
                      background: isFailed ? "rgba(220,38,38,0.10)" : "rgba(245,240,232,0.05)",
                      border: `1px solid ${isFailed ? "rgba(220,38,38,0.24)" : "rgba(245,240,232,0.08)"}`,
                    }}
                  >
                    <div style={{ width: "42px", height: "56px", borderRadius: "10px", overflow: "hidden", position: "relative", flexShrink: 0, background: "rgba(245,240,232,0.08)" }}>
                      <ManagedImage
                        src={item.thumbnail_url || item.image_url}
                        alt={`${item.category} processing`}
                        fallbackSrc={`https://placehold.co/84x112/F5F0E8/8A8580?text=${encodeURIComponent(item.category)}`}
                        fill
                        sizes="42px"
                        style={{ objectFit: "cover" }}
                      />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--cream)", textTransform: "capitalize", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.category} · {resolveColorName(item.color || "") || "Processing"}
                      </p>
                      <p style={{ fontSize: "12px", color: isFailed ? "#FCA5A5" : "rgba(244,238,228,0.72)", lineHeight: 1.4 }}>
                        {getMediaStatusLabel(item)}
                      </p>
                    </div>
                    {isFailed ? (
                      <button
                        onClick={() => setMediaActivity((prev) => {
                          const next = { ...prev };
                          delete next[item.id];
                          return next;
                        })}
                        style={{ border: "none", background: "transparent", color: "#FCA5A5", cursor: "pointer", padding: "2px" }}
                        aria-label="Dismiss failed upload"
                        title="Dismiss"
                      >
                        <X size={16} />
                      </button>
                    ) : (
                      <Loader size={16} color="var(--gold)" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

function ManagedImage({
  src,
  alt,
  fallbackSrc,
  sizes,
  style,
  fill = false,
  width,
  height,
  priority = false,
  onLoad,
  crossOrigin,
}: {
  src: string;
  alt: string;
  fallbackSrc?: string;
  sizes?: string;
  style?: React.CSSProperties;
  fill?: boolean;
  width?: number;
  height?: number;
  priority?: boolean;
  onLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  crossOrigin?: "" | "anonymous" | "use-credentials";
}) {
  const [imageSrc, setImageSrc] = useState(src);

  useEffect(() => {
    setImageSrc(src);
  }, [src]);

  return (
    <Image
      src={imageSrc}
      alt={alt}
      unoptimized={shouldBypassImageOptimization(imageSrc)}
      fill={fill}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      sizes={sizes}
      priority={priority}
      crossOrigin={crossOrigin}
      onLoad={onLoad}
      onError={() => {
        if (fallbackSrc && imageSrc !== fallbackSrc) setImageSrc(fallbackSrc);
      }}
      style={style}
    />
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ReviewPanel
// ═══════════════════════════════════════════════════════════════════════════════

function ReviewPanel({
  previewUrl, aiTags, tagOptions, tagOptionsLoading,
  correctedCat, correctedColor,
  descriptors, duplicate,
  seasonWarning, archiveAfterSave,
  onCatChange, onColorChange,
  onDescriptorChange, onReplaceExisting, onKeepBoth,
  onArchiveAfterSaveChange,
  onConfirm, onCancel,
}: {
  previewUrl: string;
  aiTags: TagPreview;
  tagOptions: TagOptions;
  tagOptionsLoading: boolean;
  correctedCat: string;
  correctedColor: string;
  onCatChange: (v: string) => void;
  onColorChange: (v: string) => void;
  descriptors: Record<string, string>;
  onDescriptorChange: (key: string, val: string) => void;
  duplicate?: TagPreview["duplicate"];
  seasonWarning?: string | null;
  archiveAfterSave: boolean;
  onArchiveAfterSaveChange: (value: boolean) => void;
  onReplaceExisting: () => void;
  onKeepBoth: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const catChanged = correctedCat !== aiTags.category;
  const colorChanged = correctedColor !== aiTags.color;
  const aiUnavailable = !!aiTags.needs_review;
  const categoryOptions = tagOptions.categories.length > 0
    ? tagOptions.categories
    : [correctedCat].filter(Boolean);

  return (
    <div className="card fade-up" style={{ marginBottom: "32px", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p className="type-body" style={{ fontWeight: 600, fontSize: "15px", color: "var(--charcoal)" }}>Review AI tags</p>
          <p className="type-helper" style={{ color: "var(--muted)", fontSize: "13px" }}>Correct category or colour if needed, then confirm</p>
        </div>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}>
          <X size={18} />
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap" }}>
        {/* Clickable image for eyedropper */}
        <ImageEyedropper
          previewUrl={previewUrl}
          onColorPicked={onColorChange}
        />

        {/* Fields */}
        <div style={{ flex: 1, padding: "20px", minWidth: "300px" }}>

          {aiUnavailable && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", background: "rgba(212,169,106,0.10)", border: "1px solid rgba(212,169,106,0.28)", borderRadius: "8px", padding: "10px 12px", marginBottom: "16px" }}>
              <AlertCircle size={15} color="#B8860B" style={{ flexShrink: 0, marginTop: "1px" }} />
              <p style={{ fontSize: "13px", color: "var(--gold)", lineHeight: 1.4 }}>
                AI couldn&apos;t analyse this image — defaults pre-filled. Please review before saving.
              </p>
            </div>
          )}

          {/* Duplicate warning */}
          {duplicate && (
            <div style={{
              background: "rgba(212,169,106,0.10)", border: "1px solid rgba(212,169,106,0.28)",
              borderRadius: "8px", padding: "14px", marginBottom: "16px",
            }}>
                <p className="type-helper" style={{ fontSize: "13px", fontWeight: 600, color: "var(--gold-light)", marginBottom: "12px" }}>
                  This item looks like a duplicate ({Math.round(duplicate.score * 100)}% similar)
                </p>

              {/* Side-by-side comparison */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "6px",
                    textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
                    New
                  </p>
                  <div style={{ width: "100%", aspectRatio: "3/4", position: "relative" }}>
                    <ManagedImage
                      src={previewUrl}
                      alt="new item"
                      fill
                      sizes="(max-width: 768px) 40vw, 240px"
                      style={{ objectFit: "cover", borderRadius: "6px", border: "2px solid #D97706" }}
                    />
                  </div>
                  <p style={{ fontSize: "12px", color: "var(--ink)", marginTop: "4px",
                    textTransform: "capitalize" }}>
                    {correctedCat} · {correctedColor}
                  </p>
                </div>
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "6px",
                    textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
                    Existing
                  </p>
                  <div style={{ width: "100%", aspectRatio: "3/4", position: "relative" }}>
                    <ManagedImage
                      src={duplicate.image_url}
                      alt="existing item"
                      fallbackSrc={`https://placehold.co/300x400/F5F0E8/8A8580?text=${encodeURIComponent(duplicate.category)}`}
                      fill
                      sizes="(max-width: 768px) 40vw, 240px"
                      style={{ objectFit: "cover", borderRadius: "6px", border: "1px solid var(--border)" }}
                    />
                  </div>
                  <p style={{ fontSize: "12px", color: "var(--ink)", marginTop: "4px",
                    textTransform: "capitalize" }}>
                    {duplicate.category} · {duplicate.color}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={onReplaceExisting}
                  style={{ flex: 1, fontSize: "12px", fontWeight: 600, padding: "7px 12px",
                    borderRadius: "6px", border: "none", background: "var(--gold)",
                    color: "white", cursor: "pointer" }}>
                  Replace existing
                </button>
                <button onClick={onKeepBoth}
                  style={{ flex: 1, fontSize: "12px", padding: "7px 12px",
                    borderRadius: "6px", border: "1px solid var(--border)",
                    background: "var(--surface)", color: "var(--muted)", cursor: "pointer" }}>
                  Keep both
                </button>
              </div>
            </div>
          )}

          {/* Category */}
          <div style={{ marginBottom: "20px" }}>
            <label htmlFor="review-category" style={labelStyle}>Category {catChanged && <ChangedBadge />}</label>
            <select id="review-category" name="category" value={correctedCat} onChange={e => onCatChange(e.target.value)}
              disabled={tagOptionsLoading && tagOptions.categories.length === 0}
              className="input" style={{ padding: "8px 12px", fontSize: "14px", textTransform: "capitalize" }}>
              {categoryOptions.map(c => (
                <option key={c} value={c} style={{ textTransform: "capitalize" }}>{c}</option>
              ))}
            </select>
            {tagOptionsLoading && tagOptions.categories.length === 0 && (
              <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px" }}>Loading category options…</p>
            )}
            {catChanged && <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px" }}>AI said: <em style={{ textTransform: "capitalize" }}>{aiTags.category}</em></p>}
          </div>

          {/* Color */}
          <div style={{ marginBottom: "20px" }}>
            <label style={labelStyle}>Colour {colorChanged && <ChangedBadge />}</label>
            <ColorPicker
              selected={correctedColor}
              onSelect={onColorChange}
            />
            {colorChanged && <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px" }}>AI said: <em style={{ textTransform: "capitalize" }}>{aiTags.color}</em></p>}
          </div>

          {/* Style details — collapsible */}
          {(() => {
            const allDescriptors = getDescriptorOptionsForCategory(correctedCat, descriptors);
            if (!Object.keys(allDescriptors).length) return null;

            return (
              <StyleDetailsSection
                allDescriptors={allDescriptors}
                descriptors={descriptors}
                onDescriptorChange={onDescriptorChange}
              />
              );
          })()}

          {seasonWarning && (
            <div style={{
              marginBottom: "16px",
              padding: "12px 14px",
              borderRadius: "8px",
              background: "rgba(212,169,106,0.10)",
              border: "1px solid rgba(212,169,106,0.28)",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                <AlertCircle size={15} color="#B8860B" style={{ flexShrink: 0, marginTop: "1px" }} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: "13px", color: "var(--gold)", lineHeight: 1.5, margin: 0 }}>
                    {seasonWarning}
                  </p>
                  <label style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginTop: "8px",
                    fontSize: "12px",
                    color: "var(--charcoal)",
                    cursor: "pointer",
                  }}>
                    <input
                      id="archive-after-save"
                      name="archive_after_save"
                      type="checkbox"
                      checked={archiveAfterSave}
                      onChange={(e) => onArchiveAfterSaveChange(e.target.checked)}
                      style={{ accentColor: "var(--gold)" }}
                    />
                    Archive this item after saving
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: "10px" }}>
            <button className="btn-primary" onClick={onConfirm} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <CheckCircle size={15} /> Confirm &amp; Save
            </button>
            <button className="btn-secondary" onClick={onCancel} style={{ fontSize: "13px" }}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ImageEyedropper — click anywhere on the preview image to sample its color
// ═══════════════════════════════════════════════════════════════════════════════

function ImageEyedropper({ previewUrl, onColorPicked }: {
  previewUrl: string;
  onColorPicked: (hex: string) => void;
}) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const [ready,    setReady]    = useState(false);
  const [eyedrop,  setEyedrop]  = useState(false);
  const [pickedHex, setPickedHex] = useState<string | null>(null);

  // Draw the image onto the hidden canvas once loaded
  function handleImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img    = e.currentTarget;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) { ctx.drawImage(img, 0, 0); setReady(true); }
  }

  function handleImageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!eyedrop || !ready || !canvasRef.current) return;
    const rect   = e.currentTarget.getBoundingClientRect();
    const scaleX = canvasRef.current.width  / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top)  * scaleY);
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    const data = ctx.getImageData(x, y, 1, 1).data;
    const r = data[0];
    const g = data[1];
    const b = data[2];
    const hex = `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
    setPickedHex(hex);
    onColorPicked(hex);
    setEyedrop(false);
    toast.success("Colour sampled!");
  }

  return (
    <div style={{ width: "160px", flexShrink: 0, position: "relative" }}>
      <div
        onClick={handleImageClick}
        style={{ cursor: eyedrop ? "crosshair" : "default", position: "relative" }}
      >
        <ManagedImage
          src={previewUrl}
          alt="Preview"
          width={160}
          height={220}
          sizes="160px"
          crossOrigin="anonymous"
          onLoad={handleImgLoad}
          style={{ objectFit: "cover", display: "block" }}
        />
        {eyedrop && (
          <div style={{
            position: "absolute", inset: 0,
            background: "rgba(212,169,106,0.18)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ background: "rgba(0,0,0,0.6)", borderRadius: "8px", padding: "6px 10px", color: "white", fontSize: "12px", textAlign: "center" }}>
              <Pipette size={16} style={{ display: "block", margin: "0 auto 4px" }} />
              Click to sample
            </div>
          </div>
        )}
      </div>

      {/* Hidden canvas for pixel sampling */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Eyedropper toggle button */}
      <button
        onClick={() => setEyedrop(v => !v)}
        title="Pick colour from image"
        style={{
          position: "absolute", bottom: "8px", right: "8px",
          background: eyedrop ? "var(--gold)" : "rgba(24,23,20,0.85)",
          border: "none", borderRadius: "6px", padding: "6px",
          cursor: "pointer", display: "flex", alignItems: "center",
          boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
        }}
      >
        <Pipette size={16} color={eyedrop ? "white" : "var(--charcoal)"} />
      </button>

      {/* Show sampled hex swatch */}
      {pickedHex && (
        <div style={{ padding: "6px 8px", background: "var(--surface)", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ width: "14px", height: "14px", borderRadius: "3px", background: pickedHex, border: "1px solid var(--border)", flexShrink: 0 }} />
          <span style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "monospace" }}>{pickedHex}</span>
        </div>
      )}

      <p style={{ fontSize: "11px", color: "var(--muted)", textAlign: "center", padding: "4px 0 0", lineHeight: 1.3 }}>
        Click <Pipette size={10} style={{ display: "inline", verticalAlign: "middle" }} /> to sample a pixel
      </p>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ColorPicker — preset swatches + custom hex input
// ═══════════════════════════════════════════════════════════════════════════════

function ColorPicker({ selected, onSelect }: { selected: string; onSelect: (key: string) => void }) {
  const [customHex, setCustomHex] = useState("");

  // Determine if selected is a preset key or a custom hex
  const isPreset  = SOLID_COLORS.some(c => c.key === selected);
  const isCustom  = selected.startsWith("#") && !isPreset;
  const isPattern = selected === "pattern";

  const displayLabel = isPreset
    ? SOLID_COLORS.find(c => c.key === selected)?.label
    : isPattern ? "Pattern"
    : isCustom  ? selected
    : selected;

  return (
    <div>
      {/* Preset swatches */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
        {SOLID_COLORS.map(c => (
          <button key={c.key} title={c.label} onClick={() => onSelect(c.key)} style={{
            width: "28px", height: "28px", borderRadius: "50%",
            background: c.hex,
            border: selected === c.key ? "3px solid var(--charcoal)" : "2px solid transparent",
            outline: selected === c.key ? "2px solid var(--cream)" : "none",
            cursor: "pointer", transition: "transform 0.1s ease",
            transform: selected === c.key ? "scale(1.15)" : "scale(1)",
          }} />
        ))}
      </div>

      {/* Custom hex input */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <input
          name="custom_colour_picker"
          aria-label="Pick a custom colour"
          type="color"
          value={isCustom ? selected : "#ffffff"}
          onChange={e => { setCustomHex(e.target.value); onSelect(e.target.value); }}
          title="Pick a custom colour"
          style={{ width: "32px", height: "32px", border: "1px solid var(--border)", borderRadius: "6px", cursor: "pointer", padding: "2px" }}
        />
        <input
          name="custom_colour_hex"
          aria-label="Custom colour hex"
          type="text"
          value={isCustom ? selected : customHex}
          placeholder="#hex or type colour"
          onChange={e => { const v = e.target.value; setCustomHex(v); if (/^#[0-9a-f]{6}$/i.test(v)) onSelect(v); }}
          style={{ flex: 1, padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "13px", fontFamily: "monospace" }}
        />
      </div>

      {/* Selected label */}
      <p style={{ fontSize: "12px", color: "var(--muted)", marginTop: "6px", textTransform: isCustom ? "none" : "capitalize" }}>
        Selected: <strong style={{ color: "var(--ink)" }}>{displayLabel}</strong>
        {isCustom && <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "3px", background: selected, border: "1px solid var(--border)", marginLeft: "6px", verticalAlign: "middle" }} />}
      </p>
    </div>
  );
}



// ═══════════════════════════════════════════════════════════════════════════════
// StyleDetailsSection — dropdown with name + inline SVG swatch
// ═══════════════════════════════════════════════════════════════════════════════

function StyleDetailsSection({ allDescriptors, descriptors, onDescriptorChange }: {
  allDescriptors: Record<string, string[]>;
  descriptors: Record<string, string>;
  onDescriptorChange: (key: string, val: string) => void;
}) {
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [showAddPicker, setShowAddPicker] = useState(false);

  const filledEntries = Object.entries(descriptors).filter(([, v]) => v);
  const emptyGroups   = Object.keys(allDescriptors).filter(k => !descriptors[k]);

  function handleTagClick(key: string) {
    setShowAddPicker(false);
    setActiveGroup(prev => prev === key ? null : key);
  }

  function handleRemove(key: string, e: React.MouseEvent) {
    e.stopPropagation();
    onDescriptorChange(key, "");
    if (activeGroup === key) setActiveGroup(null);
  }

  return (
    <div style={{ marginBottom: "20px" }}>
      <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)",
        textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "8px" }}>
        Style details
      </p>

      {/* Filled tags */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
        {filledEntries.map(([key, val]) => (
          <div key={key}>
            <button
              onClick={() => handleTagClick(key)}
              style={{
                display: "inline-flex", alignItems: "center", gap: "5px",
                padding: "4px 10px", fontSize: "12px", borderRadius: "20px",
                cursor: "pointer", textTransform: "capitalize",
                border: `1px solid ${activeGroup === key ? "var(--charcoal)" : "var(--border)"}`,
                background: activeGroup === key ? "var(--charcoal)" : "var(--surface)",
                color: activeGroup === key ? "#0A0908" : "var(--muted)",
                transition: "all 0.12s",
              }}>
              {val}
              <span
                onClick={e => handleRemove(key, e)}
                style={{ fontSize: "11px", opacity: 0.6, lineHeight: 1, cursor: "pointer" }}>
                ×
              </span>
            </button>

            {/* Inline group picker — shown below the clicked tag */}
            {activeGroup === key && (
              <div style={{
                marginTop: "6px", padding: "10px 12px",
                background: "var(--input-bg)", borderRadius: "8px",
                border: "1px solid var(--border)",
              }}>
                <p style={{ fontSize: "11px", color: "var(--muted)",
                  textTransform: "capitalize", marginBottom: "8px", fontWeight: 600 }}>
                  {getDescriptorGroupLabel(key)}
                </p>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {(allDescriptors[key] || []).map(opt => (
                    <button key={opt}
                      onClick={() => {
                        if (opt !== val) onDescriptorChange(key, opt);
                        setActiveGroup(null);
                      }}
                      style={{
                        padding: "4px 12px", fontSize: "12px", borderRadius: "20px",
                        cursor: "pointer", textTransform: "capitalize",
                        border: `1px solid ${val === opt ? "var(--charcoal)" : "var(--border)"}`,
                        background: val === opt ? "var(--gold)" : "var(--surface)",
                        color: val === opt ? "#0A0908" : "var(--muted)",
                        transition: "all 0.12s",
                      }}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* + Add detail button */}
        {emptyGroups.length > 0 && (
          <button
            onClick={() => { setShowAddPicker(p => !p); setActiveGroup(null); }}
            style={{
              padding: "4px 10px", fontSize: "12px", borderRadius: "20px",
              cursor: "pointer", border: "1px dashed var(--border)",
              background: "transparent", color: "var(--muted)",
            }}>
            + Add detail
          </button>
        )}

        {filledEntries.length === 0 && !showAddPicker && (
          <p style={{ fontSize: "12px", color: "var(--muted)" }}>
            No style details detected — click Add detail to fill manually
          </p>
        )}
      </div>

      {/* Add detail accordion */}
      {showAddPicker && (
        <div style={{
          marginTop: "10px", padding: "12px",
          background: "var(--input-bg)", borderRadius: "8px",
          border: "1px solid var(--border)",
          display: "flex", flexDirection: "column", gap: "12px",
        }}>
          {emptyGroups.map(key => (
            <div key={key}>
              <p style={{ fontSize: "11px", color: "var(--muted)",
                textTransform: "capitalize", marginBottom: "6px", fontWeight: 600 }}>
                {getDescriptorGroupLabel(key)}
              </p>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {(allDescriptors[key] || []).map(opt => (
                  <button key={opt}
                    onClick={() => {
                      onDescriptorChange(key, opt);
                      if (opt !== descriptors[key]) setShowAddPicker(false);
                    }}
                    style={{
                      padding: "4px 12px", fontSize: "12px", borderRadius: "20px",
                      cursor: "pointer", textTransform: "capitalize",
                      border: "1px solid var(--border)",
                      background: "var(--surface)", color: "var(--muted)",
                      transition: "all 0.12s",
                    }}>
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ItemCard — popup edit modal + archive confirmation
// ═══════════════════════════════════════════════════════════════════════════════

function ItemCard({ item, priority = false, onEdit, onRequestDelete }: {
  item: ClothingItem;
  priority?: boolean;
  onEdit: () => void;
  onRequestDelete: () => void;
}) {
  const formalityLabel =
    item.formality_score !== undefined
      ? item.formality_score >= 0.75 ? "Formal"
      : item.formality_score >= 0.50 ? "Smart casual"
      : item.formality_score >= 0.25 ? "Casual"
      : "Loungewear"
      : null;

  const colorDisplay = COLOR_HEX[item.color || ""]
    ?? ((item.color || "") === "pattern" ? "linear-gradient(135deg,#e8a0a0 25%,#4a90c4 75%)" : undefined)
    ?? ((item.color || "").startsWith("#") ? item.color : "#ccc");
  const mediaBadge = getMediaBadgeLabel(item);

  return (
    <div className="card" style={{ overflow: "hidden", position: "relative" }}>
      <div style={{ aspectRatio: "3/4", overflow: "hidden", background: "var(--surface)", position: "relative" }}>
          <ManagedImage
            src={item.thumbnail_url || item.image_url}
            alt={`${item.category} - ${resolveColorName(item.color || "")}`}
            fallbackSrc={`https://placehold.co/300x400/F5F0E8/8A8580?text=${encodeURIComponent(item.category)}`}
            fill
            sizes="(max-width: 768px) 50vw, 200px"
            priority={priority}
            style={{ objectFit: "cover" }}
          />
        {mediaBadge && (
          <div style={{
            position: "absolute",
            top: "8px",
            left: "8px",
            padding: "6px 8px",
            borderRadius: "999px",
            background: item.media_status === "failed" ? "rgba(220,38,38,0.90)" : "rgba(24,23,20,0.78)",
            color: "white",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            backdropFilter: "blur(8px)",
          }}>
            {mediaBadge}
          </div>
        )}
        <div className="card-actions" style={{ position: "absolute", top: "8px", right: "8px", display: "flex", flexDirection: "column", gap: "4px", opacity: 0, transition: "opacity 0.2s ease" }}>
          <ActionBtn onClick={onEdit} icon={<Pencil size={13} />} label="Edit item" />
          <ActionBtn onClick={onRequestDelete} icon={<Archive size={13} color="#D4A96A" />} label="Archive item" />
        </div>
      </div>

      <div style={{ padding: "12px" }}>
        <p style={{ fontWeight: 500, fontSize: "14px", textTransform: "capitalize", marginBottom: "4px" }}>
          <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: colorDisplay as string, marginRight: "6px", verticalAlign: "middle", border: "1px solid var(--border)" }} />
          {item.category} - {resolveColorName(item.color || "")}
        </p>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          {item.season && (
            <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "capitalize" }}>
              {item.season}
            </span>
          )}
          {formalityLabel && (
            <span className="formality-pill" style={{
              background: (item.formality_score||0) > 0.6 ? "rgba(212,169,106,0.12)" : "rgba(122,148,104,0.15)",
              color:      (item.formality_score||0) > 0.6 ? "var(--charcoal)" : "var(--sage)",
            }}>{formalityLabel}</span>
          )}
        </div>

        {item.descriptors && Object.keys(item.descriptors).length > 0 && (
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "6px" }}>
            {Object.entries(item.descriptors as Record<string, string>)
              .filter(([, val]) => Boolean(val))
              .map(([key, val], i) => (
                <span key={i} style={{
                  fontSize: "10px", padding: "2px 8px", borderRadius: "20px",
                  background: "var(--surface)", border: "1px solid var(--border)",
                  color: "var(--muted)", textTransform: "capitalize",
                }}>
                  {key.startsWith("top_") || key.startsWith("bottom_")
                    ? `${getDescriptorGroupLabel(key)}: ${val}`
                    : val}
                </span>
              ))}
          </div>
        )}
      </div>

      <style>{`.card:hover .card-actions { opacity: 1 !important; }`}</style>
    </div>
  );
}

function ItemEditModal({
  item,
  tagOptions,
  tagOptionsLoading,
  onRequestTagOptions,
  onClose,
  onSave,
}: {
  item: ClothingItem;
  tagOptions: TagOptions;
  tagOptionsLoading: boolean;
  onRequestTagOptions: () => Promise<void> | void;
  onClose: () => void;
  onSave: (cat: string, color: string, pattern: string, descriptors: Record<string, string>) => void;
}) {
  const [editCat, setEditCat] = useState(item.category);
  const [editColor, setEditColor] = useState(item.color || "");
  const [editPattern, setEditPattern] = useState(item.pattern || "");
  const [editDescriptors, setEditDescriptors] = useState<Record<string, string>>(item.descriptors || {});

  useEffect(() => {
    setEditCat(item.category);
    setEditColor(item.color || "");
    setEditPattern(item.pattern || "");
    setEditDescriptors(item.descriptors || {});
  }, [item]);

  useEffect(() => {
    void onRequestTagOptions();
  }, [onRequestTagOptions]);

  const activeColorKey = editColor === "" ? null
    : SOLID_COLORS.some(c => c.key === editColor) ? editColor
    : normalizeToPresetKey(editColor);

  const editCategoryOptions = tagOptions.categories.length > 0
    ? tagOptions.categories
    : [editCat].filter(Boolean);

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000 }}
      />

      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 1001, background: "var(--surface)", borderRadius: "12px",
        width: "min(760px, 94vw)", maxHeight: "88vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.25)",
        overflow: "hidden",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div>
            <p style={{ fontWeight: 600, fontSize: "15px", color: "var(--charcoal)" }}>Edit Tags</p>
            <p style={{ color: "var(--muted)", fontSize: "12px", textTransform: "capitalize" }}>
              {item.category} · {resolveColorName(item.color || "")}
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: "4px" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "20px", overflowY: "auto", flex: 1 }}>
          <div style={{ display: "flex", gap: "20px", alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: "0 0 220px", width: "220px", maxWidth: "100%", margin: "0 auto" }}>
              <div style={{ position: "sticky", top: 0 }}>
                <div style={{ width: "100%", aspectRatio: "3 / 4", position: "relative", borderRadius: "12px", overflow: "hidden", background: "var(--input-bg)", border: "1px solid var(--border)" }}>
                  <ManagedImage
                    src={item.thumbnail_url || item.image_url}
                    alt={`${item.category} reference`}
                    fallbackSrc={`https://placehold.co/300x400/F5F0E8/8A8580?text=${encodeURIComponent(item.category)}`}
                    fill
                    sizes="220px"
                    style={{ objectFit: "cover" }}
                  />
                </div>
                <p style={{ fontSize: "12px", color: "var(--muted)", marginTop: "10px", lineHeight: 1.4 }}>
                  Reference image for category, colour, and pattern edits.
                </p>
              </div>
            </div>

            <div style={{ flex: "1 1 340px", minWidth: "280px" }}>
              <label htmlFor="edit-item-category" style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: "6px" }}>Category</label>
              <select id="edit-item-category" name="edit_category" value={editCat} onChange={e => setEditCat(e.target.value)}
                disabled={tagOptionsLoading && tagOptions.categories.length === 0}
                className="input" style={{ padding: "8px 12px", fontSize: "14px", marginBottom: "20px", textTransform: "capitalize" }}>
                {editCategoryOptions.map(c => <option key={c} value={c} style={{ textTransform: "capitalize" }}>{c}</option>)}
              </select>
              {tagOptionsLoading && tagOptions.categories.length === 0 && (
                <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "-14px", marginBottom: "16px" }}>Loading category options…</p>
              )}

              <label htmlFor="edit-item-colour-custom" style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: "8px" }}>Colour</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                {SOLID_COLORS.map(c => (
                  <button key={c.key} title={c.label} onClick={() => setEditColor(c.key)} style={{
                    width: "26px", height: "26px", borderRadius: "50%", background: c.hex,
                    border: activeColorKey === c.key ? "3px solid var(--charcoal)" : "2px solid transparent",
                    outline: activeColorKey === c.key ? "2px solid var(--cream)" : "none",
                    cursor: "pointer",
                    transform: activeColorKey === c.key ? "scale(1.15)" : "scale(1)",
                    transition: "transform 0.1s ease",
                  }} />
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px", flexWrap: "wrap" }}>
                <input id="edit-item-colour-custom" name="edit_colour_custom" type="color" value={editColor.startsWith("#") ? editColor : "#ffffff"}
                  onChange={e => setEditColor(e.target.value)}
                  style={{ width: "32px", height: "32px", border: "1px solid var(--border)", borderRadius: "6px", cursor: "pointer", padding: "2px" }} />
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>or pick custom</span>
              </div>

              <label style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: "8px" }}>Pattern</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "20px" }}>
                {PATTERNS.map(p => (
                  <button key={p.key} title={p.label} onClick={() => setEditPattern(editPattern === p.key ? "" : p.key)}
                    style={{ padding: "4px 12px", borderRadius: "20px", fontSize: "12px", cursor: "pointer",
                      border: editPattern === p.key ? "2px solid var(--charcoal)" : "1px solid var(--border)",
                      background: editPattern === p.key ? "var(--gold)" : "var(--surface)",
                      color: editPattern === p.key ? "#0A0908" : "var(--muted)", textTransform: "capitalize" }}>
                    {p.label}
                  </button>
                ))}
              </div>

              {(() => {
                const allDescriptors = getDescriptorOptionsForCategory(editCat, editDescriptors);
                if (!Object.keys(allDescriptors).length) return null;
                return (
                  <div>
                    <label style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: "10px" }}>Style Details</label>
                    {Object.entries(allDescriptors).map(([key, opts]) => (
                      <div key={key} style={{ marginBottom: "12px" }}>
                        <p style={{ fontSize: "11px", color: "var(--muted)", textTransform: "capitalize", marginBottom: "6px" }}>{getDescriptorGroupLabel(key)}</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                          {(opts as string[]).map(opt => (
                            <button key={opt} onClick={() => setEditDescriptors(prev => ({ ...prev, [key]: prev[key] === opt ? "" : opt }))}
                              style={{ padding: "3px 10px", borderRadius: "20px", fontSize: "11px", cursor: "pointer",
                                border: editDescriptors[key] === opt ? "2px solid var(--charcoal)" : "1px solid var(--border)",
                                background: editDescriptors[key] === opt ? "var(--gold)" : "var(--surface)",
                                color: editDescriptors[key] === opt ? "#0A0908" : "var(--muted)", textTransform: "capitalize" }}>
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: "8px", flexShrink: 0, background: "var(--surface)" }}>
          <button
            onClick={() => onSave(editCat, editColor, editPattern, editDescriptors)}
            className="btn-primary" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <CheckCircle size={14} /> Save
          </button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </>
  );
}

function DeleteItemDialog({
  item,
  onClose,
  onConfirm,
}: {
  item: ClothingItem;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000 }}
      />
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 1001, background: "var(--surface)", borderRadius: "12px",
        width: "min(360px, 92vw)", padding: "22px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.25)",
      }}>
        <p style={{ fontWeight: 600, fontSize: "16px", color: "var(--charcoal)", marginBottom: "8px" }}>
          Archive this item?
        </p>
        <p style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "18px", textTransform: "capitalize" }}>
          {item.category} · {resolveColorName(item.color || "")}
        </p>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={onConfirm}
            style={{ padding: "8px 16px", borderRadius: "6px", border: "none", background: "var(--gold)", color: "#0A0908", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
          >
            Archive
          </button>
        </div>
      </div>
    </>
  );
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function ActionBtn({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{ background: "rgba(24,23,20,0.82)", border: "none", borderRadius: "6px", padding: "6px", cursor: "pointer", display: "flex", alignItems: "center" }}
    >
      {icon}
    </button>
  );
}

function ChangedBadge() {
  return <span style={{ marginLeft: "6px", fontSize: "10px", color: "var(--gold)", fontWeight: 600, letterSpacing: "0.05em" }}>EDITED</span>;
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "11px", fontWeight: 600,
  color: "var(--muted)", textTransform: "uppercase",
  letterSpacing: "0.07em", marginBottom: "6px",
};

function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "80px 24px", color: "var(--muted)" }}>
      <ShirtIcon size={48} color="var(--border)" style={{ margin: "0 auto 16px", display: "block" }} />
      <h3 className="type-section-title" style={{ fontFamily: "Playfair Display, serif", color: "var(--charcoal)", marginBottom: "8px" }}>Your wardrobe is empty</h3>
      <p className="type-body" style={{ fontSize: "15px" }}>Upload your first clothing item to get started</p>
    </div>
  );
}

function FilteredEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div style={{ textAlign: "center", padding: "72px 24px", color: "var(--muted)" }}>
      <ShirtIcon size={44} color="var(--border)" style={{ margin: "0 auto 16px", display: "block" }} />
      <h3 className="type-section-title" style={{ fontFamily: "Playfair Display, serif", color: "var(--charcoal)", marginBottom: "8px" }}>
        No items match these filters
      </h3>
      <p className="type-body" style={{ fontSize: "15px", marginBottom: "18px" }}>
        Try a different combination or clear your filters to see everything again.
      </p>
      <button className="btn-secondary" onClick={onClear}>
        Clear filters
      </button>
    </div>
  );
}
