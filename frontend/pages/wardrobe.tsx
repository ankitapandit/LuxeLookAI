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

import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import { getItemDisplayName } from "@/utils/itemDisplay";
import {
  getTagOptions, correctItem,
  deleteClothingItem, deleteClothingItemForever, purgeArchivedClothingItem, getWardrobeItemsPage, getDeletedItems, restoreClothingItem,
  getWardrobeMediaStatus, TagOptions, ClothingItem,
} from "@/services/api";
import { Archive, ShirtIcon, Loader, CheckCircle, Pencil, X, RotateCcw, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

// Maps any stored color name back to the nearest SOLID_COLORS key so the
// correct swatch is highlighted in the edit modal for existing items.
function normalizeToPresetKey(color: string): string | null {
  if (!color) return null;
  if (color.startsWith("#")) return null; // custom hex — no swatch match
  if (SOLID_COLORS.some(c => c.key === color)) return color;
  const lower = color.toLowerCase();
  // Explicit overrides for common normalized names
  const overrides: Record<string, string> = {
    "multicolor": "multicolor", "multi color": "multicolor", "multi-colour": "multicolor", "multi colour": "multicolor",
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

function applyWardrobeRemovalState(
  itemId: string,
  setItems: Dispatch<SetStateAction<ClothingItem[]>>,
  setTrackedMediaIds: Dispatch<SetStateAction<string[]>>,
  setMediaActivity: Dispatch<SetStateAction<Record<string, ClothingItem>>>,
  setTotalCount: Dispatch<SetStateAction<number>>,
  setWardrobeTotalCount: Dispatch<SetStateAction<number>>,
) {
  let removedCount = 0;
  setItems((prev) => {
    removedCount = prev.some((item) => item.id === itemId) ? 1 : 0;
    return prev.filter((item) => item.id !== itemId);
  });
  setTrackedMediaIds((prev) => prev.filter((id) => id !== itemId));
  setMediaActivity((prev) => {
    const next = { ...prev };
    delete next[itemId];
    return next;
  });
  if (removedCount) {
    setTotalCount((prev) => Math.max(0, prev - 1));
    setWardrobeTotalCount((prev) => Math.max(0, prev - 1));
  }
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
  { key: "multicolor", hex: "linear-gradient(135deg, #c0392b 0%, #d4a843 24%, #4a7c59 48%, #4a90c4 72%, #7c5cbf 100%)", label: "Multicolor" },
];

// Map key → hex for item card display
const COLOR_HEX: Record<string, string> = Object.fromEntries(
  SOLID_COLORS.map(c => [c.key, c.hex])
);

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
  "ribbed",
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
    warmth:        ["airy","light","medium","warm","thermal"],
    neckline:      ["crew","round","boat","V-neck","plunging","jewel","square","scoop",
                    "sweetheart","off-shoulder","strapless","halter","high neck",
                    "turtleneck","collar","cowl","one shoulder","tie neck","apron neck",
                    "queen anne","asymmetrical","keyhole neck","scalloped neck","illusion neck"],
    sleeve_length: ["sleeveless","cap","short","3/4","long"],
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
    warmth:        ["airy","light","medium","warm","thermal"],
    neckline:      ["crew","round","boat","V-neck","plunging","jewel","square","scoop",
                    "sweetheart","off-shoulder","strapless","halter","high neck",
                    "turtleneck","collar","cowl","one shoulder","tie neck","apron neck",
                    "queen anne","asymmetrical","keyhole neck","scalloped neck","illusion neck"],
    sleeve_length: ["sleeveless","cap","short","3/4","long"],
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
    warmth:         ["airy","light","medium","warm","thermal"],
    jumpsuit_style: ["tailored","utility","romper","playsuit","halter","strapless","boiler","evening","boho","wide-leg","straight-leg","tapered"],
    neckline:       ["crew","round","boat","V-neck","plunging","jewel","square","scoop",
                     "sweetheart","off-shoulder","strapless","halter","high neck",
                     "turtleneck","collar","cowl","one shoulder","tie neck","apron neck",
                     "queen anne","asymmetrical","keyhole neck","scalloped neck","illusion neck"],
    sleeve_length:  ["sleeveless","cap","short","3/4","long"],
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
    outerwear_type:     ["blazer","jacket","coat","trench","cardigan","bomber","puffer","shacket","cape","vest","shrug","coverup"],
    fabric_type:        [...FABRIC_OPTIONS],
    warmth:             ["airy","light","medium","warm","thermal"],
    collar_style:       ["notched","shawl","mandarin","spread","stand","funnel","hooded","lapel-free"],
    sleeve_length:      ["sleeveless","cap","short","3/4","long"],
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
    warmth:          ["airy","light","medium","warm","thermal"],
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
  // ── Jewelry ────────────────────────────────────────────────────────────────
  jewelry: {
    jewelry_type: ["necklace","earrings","bracelet","ring","watch","anklet","brooch","cuff"],
    metal:        ["gold","silver","rose gold","platinum","mixed metal"],
    stone:        ["none","pearl","diamond","gemstone","crystal","beaded"],
    style:        ["delicate","minimal","statement","sculptural","classic","vintage","embellished"],
    finish:       ["polished","matte","textured","hammered","glossy"],
    length:       ["choker","short","princess","matinee","opera","long"],
  },
  // ── Accessories ─────────────────────────────────────────────────────────────
  accessories: {
    accessory_type: ["handbag","tote","clutch","backpack","crossbody","belt",
                     "scarf","hat","sunglasses","headband","hair clip","claw clip","barrette","scrunchie","ribbon","hair scarf"],
    size:           ["mini","small","medium","large","oversized"],
    material:       ["leather","fabric","straw","metal","synthetic","satin","silk","velvet","plastic","pearl"],
    style:          ["structured","slouchy","minimalist","embellished","logo","classic","playful","statement"],
    closure:        ["zipper","magnetic","snap","drawstring"],
    strap_type:     ["top handle","crossbody","shoulder","chain"],
  },
  // ── Set (co-ord / two-piece matching sets) ────────────────────────────────
  set: {
    fabric_type:    [...FABRIC_OPTIONS],
    warmth:         ["airy","light","medium","warm","thermal"],
    top_style:      ["crop","halter","bandeau","off-shoulder","bralette","corset",
                     "blazer","shirt","camisole","waistcoat","longline"],
    bottom_style:   ["shorts","mini skirt","midi skirt","maxi skirt","trousers",
                     "wide-leg trousers","straight trousers","skirt","leggings","flared trousers"],
    fit:            ["slim","regular","relaxed","oversized","tailored","wrap","bodycon","A-line"],
    pattern:        ["solid","floral","striped","plaid","abstract","animal print",
                     "geometric","tie-dye","color-block"],
  },
  // ── Swimwear ──────────────────────────────────────────────────────────────
  swimwear: {
    swimwear_style:  ["bikini","one-piece","tankini","monokini","swim dress",
                      "rash guard","swim shorts","boardshorts","bandeau",
                      "triangle","halter","balconette","sporty"],
    coverage_level:  ["minimal","moderate","full"],
    cut:             ["high-leg","cheeky","high-waist","boyshort","brief","thong","string","skirted"],
    fabric_type:     ["nylon","polyester","spandex","elastane","lycra","recycled nylon",
                      "ribbed swim knit","textured jacquard","neoprene"],
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
  "jewelry",
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

function formatDescriptorLabel(key: string): string {
  return key.replace(/_/g, " ");
}

function getDescriptorGroupLabel(key: string): string {
  if (key.startsWith("top_")) return `Top ${formatDescriptorLabel(key.slice(4))}`;
  if (key.startsWith("bottom_")) return `Bottom ${formatDescriptorLabel(key.slice(7))}`;
  if (key.startsWith("jewelry_")) return `Jewelry ${formatDescriptorLabel(key.slice(8))}`;
  return formatDescriptorLabel(key);
}

function normalizeDescriptorToken(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

function getDisplayDescriptorValues(descriptors: Record<string, string> = {}): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of Object.values(descriptors)) {
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase() === "none") continue;

    const dedupeKey = trimmed.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    output.push(trimmed);
  }

  return output;
}

function getDescriptorOptionsForCategory(
  category: string,
  existingDescriptors: Record<string, string> = {}
): Record<string, string[]> {
  const catKey = category.toLowerCase().replace(/\s+/g, "");

  const aliasMap: Record<string, string[]> = {
    loungewear: ["tops", "bottoms"],
  };

  const categoryGroups = aliasMap[catKey]?.length
    ? [CATEGORY_DESCRIPTORS[catKey] || {}, ...aliasMap[catKey].map(key => CATEGORY_DESCRIPTORS[key] || {})]
    : [CATEGORY_DESCRIPTORS[catKey] || {}];

  const merged = mergeDescriptorGroups(...categoryGroups, COMMON_DESCRIPTORS);

  for (const [key, value] of Object.entries(existingDescriptors)) {
    if (!value) continue;
    if (!merged[key]) continue;
    merged[key] = Array.from(new Set([...(merged[key] || []), value]));
  }

  return merged;
}

function sanitizeDescriptorsForCategory(
  category: string,
  descriptors: Record<string, string> = {}
): Record<string, string> {
  const allowed = getDescriptorOptionsForCategory(category, {});
  const next: Record<string, string> = {};

  for (const [key, value] of Object.entries(descriptors)) {
    if (!value) continue;
    const options = allowed[key];
    if (!options) continue;
    const normalizedValue = normalizeDescriptorToken(value);
    const matched = options.find((option) => normalizeDescriptorToken(option) === normalizedValue);
    next[key] = matched ?? value;
  }

  return next;
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
  if (item.media_status === "pending") return "Processing preview";
  if (item.media_stage === "thumbnail") return "Generating quick preview";
  if (item.media_stage === "cutout") return "Extracting subject";
  return "Processing media";
}

function getMediaBadgeLabel(item: ClothingItem): string | null {
  if (item.media_status === "failed") return "Processing failed";
  if (item.media_status === "pending") return "Processing";
  if (item.media_status === "processing") {
    return item.media_stage === "cutout" ? "Extracting subject" : "Processing";
  }
  return null;
}

function getFormalityEditLabel(score: number | undefined): string {
  if (score === undefined || score === null) return "";
  if (score >= 0.85) return "Black Tie";
  if (score >= 0.78) return "Cocktail";
  if (score >= 0.68) return "Business Formal";
  if (score >= 0.55) return "Business Casual";
  if (score >= 0.42) return "Smart Casual";
  if (score >= 0.20) return "Casual";
  return "Loungewear";
}



// ═══════════════════════════════════════════════════════════════════════════════
// Page component
// ═══════════════════════════════════════════════════════════════════════════════

export default function WardrobePage() {
  const [items,        setItems]        = useState<ClothingItem[]>([]);
  const [totalCount,   setTotalCount]   = useState(0);
  const [wardrobeTotalCount, setWardrobeTotalCount] = useState(0);
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

  const [filterCat,       setFilterCat]       = useState("all");
  const [filterSeason,    setFilterSeason]    = useState("all");
  const [filterFormality, setFilterFormality] = useState("all");
  const [editingItem, setEditingItem] = useState<ClothingItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<ClothingItem | null>(null);
  const [foreverDeletingItem, setForeverDeletingItem] = useState<ClothingItem | null>(null);
  const [permanentlyDeletingItem, setPermanentlyDeletingItem] = useState<ClothingItem | null>(null);
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
      if (reset && filterCat === "all" && filterSeason === "all" && filterFormality === "all") {
        setWardrobeTotalCount(result.total_count);
      }
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

  useEffect(() => {
    void loadWardrobePage(true, 0);
  }, [loadWardrobePage]);

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

  useEffect(() => {
    function handleWardrobeSync(payload: unknown) {
      if (!payload || typeof payload !== "object") return;
      const itemId = (payload as { itemId?: unknown }).itemId;
      const eventType = (payload as { type?: unknown }).type;
      if (eventType !== "item_removed" || typeof itemId !== "string" || !itemId) return;

      applyWardrobeRemovalState(
        itemId,
        setItems,
        setTrackedMediaIds,
        setMediaActivity,
        setTotalCount,
        setWardrobeTotalCount,
      );
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== "luxelook:wardrobe-sync" || !event.newValue) return;
      try {
        handleWardrobeSync(JSON.parse(event.newValue));
      } catch {
        // ignore malformed sync payloads
      }
    }

    function handleCustomEvent(event: Event) {
      handleWardrobeSync((event as CustomEvent).detail);
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("luxelook:wardrobe-sync", handleCustomEvent as EventListener);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("luxelook:wardrobe-sync", handleCustomEvent as EventListener);
    };
  }, []);

  async function handleCorrect(
    itemId: string,
    category: string,
    color: string,
    pattern: string,
    season: string,
    formalityLabel: string,
    descriptors: Record<string, string>
  ) {
    try {
      const updated = await correctItem(itemId, {
        category,
        color,
        pattern: pattern || undefined,
        season: season || undefined,
        formality_label: formalityLabel || undefined,
        descriptors: Object.keys(descriptors).length > 0 ? descriptors : undefined,
      });
      const matchesFilters =
        (filterCat === "all" || updated.category === filterCat) &&
        (filterSeason === "all" || updated.season === filterSeason) &&
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
      setWardrobeTotalCount(prev => Math.max(0, prev - 1));
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

  async function handlePermanentDelete(itemId: string) {
    try {
      await purgeArchivedClothingItem(itemId);
      setDeletedItems(prev => prev.filter(i => i.id !== itemId));
      toast.success("Item permanently deleted");
    } catch (err: unknown) {
      const e = err as { response?: { status?: number } };
      if (e?.response?.status === 404) {
        toast.error("Item is no longer in the archive");
      } else {
        toast.error("Could not permanently delete item");
      }
    }
  }

  async function handlePermanentDeleteActive(itemId: string) {
    try {
      await deleteClothingItemForever(itemId);
      setItems(prev => prev.filter(i => i.id !== itemId));
      setTrackedMediaIds(prev => prev.filter(id => id !== itemId));
      setMediaActivity(prev => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setTotalCount(prev => Math.max(0, prev - 1));
      setWardrobeTotalCount(prev => Math.max(0, prev - 1));
      toast.success("Item permanently deleted");
    } catch {
      toast.error("Could not permanently delete item");
    }
  }

  const categoryFilters = CATEGORY_FILTER_OPTIONS;

  // Helper: map formality_score to the same bucket label used in the filter
  function formalityBucket(score: number | undefined): string {
    if (score === undefined || score === null) return "";
    if (score >= 0.85) return "Black Tie";
    if (score >= 0.78) return "Cocktail";
    if (score >= 0.68) return "Business Formal";
    if (score >= 0.55) return "Business Casual";
    if (score >= 0.42) return "Smart Casual";
    if (score >= 0.20) return "Casual";
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

  const displayedItems = useMemo(() => {
    const next = [...items];
    next.sort((a, b) => {
      const aStamp = a.media_updated_at || a.created_at || "";
      const bStamp = b.media_updated_at || b.created_at || "";
      return bStamp.localeCompare(aStamp);
    });
    return next;
  }, [items]);

  const wardrobeCountLabel = `${hasActiveFilters ? totalCount : wardrobeTotalCount} / ${wardrobeTotalCount}`;

  function openEditModal(item: ClothingItem) {
    setEditingItem(item);
    void ensureTagOptions();
  }

  function openDeleteDialog(item: ClothingItem) {
    setDeletingItem(item);
  }

  function openPermanentDeleteDialog(item: ClothingItem) {
    setForeverDeletingItem(item);
  }

  const activityItems = Object.values(mediaActivity).sort((a, b) =>
    (b.media_updated_at || b.created_at).localeCompare(a.media_updated_at || a.created_at)
  );
  const activeActivityCount = activityItems.filter((item) => item.media_status !== "failed").length;
  const trayPrimaryText = "#F4EEE4";
  const traySecondaryText = "rgba(244,238,228,0.78)";

  return (
    <>
      <Head><title>Wardrobe — LuxeLook AI</title></Head>
      <Navbar />
      <main className="page-main" style={{ maxWidth: "1200px", margin: "0 auto", padding: "48px 24px" }}>

        <div style={{ marginBottom: "36px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h1 className="type-page-title" style={{ fontSize: "36px", marginBottom: "8px" }}>My Wardrobe</h1>
            <p className="type-body" style={{ color: "var(--muted)", fontSize: "15px" }}>
              Wardrobe item count: {wardrobeCountLabel}
            </p>
            <p className="type-helper" style={{ color: "var(--muted)", fontSize: "14px", marginTop: "8px" }}>
              New in the rotation? Start in{" "}
              <Link
                href="/batch-upload"
                style={{ color: "var(--gold)", textDecoration: "none", fontWeight: 600 }}
              >
                Batch Upload
              </Link>
              .
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
                        marginBottom: "8px",
                      }}
                    >
                      <RotateCcw size={13} /> Restore
                    </button>
                    <button
                      onClick={() => setPermanentlyDeletingItem(item)}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                        gap: "6px", padding: "7px 0", borderRadius: "6px",
                        border: "1px solid rgba(220,38,38,0.35)", background: "rgba(220,38,38,0.10)",
                        color: "#FCA5A5", fontSize: "13px", fontWeight: 500, cursor: "pointer",
                      }}
                    >
                      <Trash2 size={13} /> Delete forever
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
                    {["all", "Loungewear", "Casual", "Smart Casual", "Business Casual", "Business Formal", "Cocktail", "Black Tie"].map(f => (
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
            ) : items.length === 0 ? (
              hasActiveFilters
                ? <FilteredEmptyState onClear={clearFilters} />
                : <EmptyState />
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "20px" }}>
                  {displayedItems.map((item, index) => (
                    <ItemCard key={item.id} item={item} priority={index < 4}
                      onEdit={() => openEditModal(item)}
                      onRequestArchive={() => openDeleteDialog(item)}
                      onRequestDelete={() => openPermanentDeleteDialog(item)}
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
          onSave={(cat, color, pattern, season, formalityLabel, nextDescriptors) => {
            void handleCorrect(editingItem.id, cat, color, pattern, season, formalityLabel, nextDescriptors);
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
      {foreverDeletingItem && (
        <ActivePermanentDeleteDialog
          item={foreverDeletingItem}
          onClose={() => setForeverDeletingItem(null)}
          onConfirm={() => {
            void handlePermanentDeleteActive(foreverDeletingItem.id);
            setForeverDeletingItem(null);
          }}
        />
      )}
      {permanentlyDeletingItem && (
        <PermanentDeleteDialog
          item={permanentlyDeletingItem}
          onClose={() => setPermanentlyDeletingItem(null)}
          onConfirm={() => {
            void handlePermanentDelete(permanentlyDeletingItem.id);
            setPermanentlyDeletingItem(null);
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
              color: trayPrimaryText,
              cursor: "pointer",
            }}
          >
            <div style={{ textAlign: "left" }}>
              <p style={{ fontSize: "13px", fontWeight: 600, marginBottom: "3px", color: trayPrimaryText }}>
                Wardrobe activity
              </p>
              <p style={{ fontSize: "12px", color: traySecondaryText }}>
                {activeActivityCount > 0
                  ? `${activeActivityCount} upload${activeActivityCount === 1 ? "" : "s"} still processing`
                  : "Uploads need attention"}
              </p>
            </div>
            <span style={{ fontSize: "12px", color: traySecondaryText, flexShrink: 0 }}>
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
                      <p style={{ fontSize: "12px", fontWeight: 600, color: trayPrimaryText, textTransform: "capitalize", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {getItemDisplayName(item) || "Processing"}
                      </p>
                      <p style={{ fontSize: "12px", color: isFailed ? "#FCA5A5" : traySecondaryText, lineHeight: 1.4 }}>
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

function ItemCard({ item, priority = false, onEdit, onRequestDelete, onRequestArchive }: {
  item: ClothingItem;
  priority?: boolean;
  onEdit: () => void;
  onRequestDelete: () => void;
  onRequestArchive: () => void;
}) {
  const formalityLabel =
    item.formality_score !== undefined
      ? item.formality_score >= 0.85 ? "Black Tie"
      : item.formality_score >= 0.78 ? "Cocktail"
      : item.formality_score >= 0.68 ? "Business Formal"
      : item.formality_score >= 0.55 ? "Business Casual"
      : item.formality_score >= 0.42 ? "Smart Casual"
      : item.formality_score >= 0.20 ? "Casual"
      : "Loungewear"
      : null;

  const colorDisplay = COLOR_HEX[item.color || ""]
    ?? ((item.color || "") === "multicolor" ? "linear-gradient(135deg,#c0392b 0%,#d4a843 24%,#4a7c59 48%,#4a90c4 72%,#7c5cbf 100%)" : undefined)
    ?? ((item.color || "") === "pattern" ? "linear-gradient(135deg,#e8a0a0 25%,#4a90c4 75%)" : undefined)
    ?? ((item.color || "").startsWith("#") ? item.color : "#ccc");
  const mediaBadge = getMediaBadgeLabel(item);

  return (
    <div className="card" style={{ overflow: "hidden", position: "relative" }}>
      <div style={{ aspectRatio: "3/4", overflow: "hidden", background: "var(--surface)", position: "relative" }}>
          <ManagedImage
            src={item.thumbnail_url || item.image_url}
            alt={getItemDisplayName(item)}
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
          <ActionBtn onClick={onRequestArchive} icon={<Archive size={13} color="#D4A96A" />} label="Archive item" />
          <ActionBtn onClick={onRequestDelete} icon={<Trash2 size={13} color="#D4A96A" />} label="Delete forever" />
        </div>
      </div>

      <div style={{ padding: "12px" }}>
        <p style={{ fontWeight: 500, fontSize: "14px", textTransform: "capitalize", marginBottom: "4px" }}>
          <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: colorDisplay as string, marginRight: "6px", verticalAlign: "middle", border: "1px solid var(--border)" }} />
          {getItemDisplayName(item)}
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

        {item.descriptors && getDisplayDescriptorValues(item.descriptors as Record<string, string>).length > 0 && (
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "6px" }}>
            {getDisplayDescriptorValues(item.descriptors as Record<string, string>).map((val, i) => (
                <span key={i} style={{
                  fontSize: "10px", padding: "2px 8px", borderRadius: "20px",
                  background: "var(--surface)", border: "1px solid var(--border)",
                  color: "var(--muted)", textTransform: "capitalize",
                }}>
                  {val}
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
  onSave: (
    cat: string,
    color: string,
    pattern: string,
    season: string,
    formalityLabel: string,
    descriptors: Record<string, string>
  ) => void;
}) {
  const [editCat, setEditCat] = useState(item.category);
  const [editColor, setEditColor] = useState(item.color || "");
  const [editSeason, setEditSeason] = useState(item.season || "");
  const [editFormalityLabel, setEditFormalityLabel] = useState(getFormalityEditLabel(item.formality_score));
  const [editDescriptors, setEditDescriptors] = useState<Record<string, string>>(
    sanitizeDescriptorsForCategory(item.category, item.descriptors || {})
  );
  const editPattern = item.pattern || "";

  useEffect(() => {
    setEditCat(item.category);
    setEditColor(item.color || "");
    setEditSeason(item.season || "");
    setEditFormalityLabel(getFormalityEditLabel(item.formality_score));
    setEditDescriptors(sanitizeDescriptorsForCategory(item.category, item.descriptors || {}));
  }, [item]);

  useEffect(() => {
    setEditDescriptors((prev) => sanitizeDescriptorsForCategory(editCat, prev));
  }, [editCat]);

  useEffect(() => {
    void onRequestTagOptions();
  }, [onRequestTagOptions]);

  const activeColorKey = editColor === "" ? null
    : SOLID_COLORS.some(c => c.key === editColor) ? editColor
    : normalizeToPresetKey(editColor);

  const editCategoryOptions = tagOptions.categories.length > 0
    ? tagOptions.categories
    : [editCat].filter(Boolean);
  const editSeasonOptions = tagOptions.seasons.length > 0
    ? tagOptions.seasons
    : [{ value: editSeason || "all", label: editSeason || "All seasons" }];
  const editFormalityOptions = tagOptions.formality_levels.length > 0
    ? tagOptions.formality_levels
    : [{ label: editFormalityLabel || "Casual", score: 0.3, description: "" }];

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
              {getItemDisplayName(item)}
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
                  Reference image for category, colour, and style detail edits.
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

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", marginBottom: "20px" }}>
                <div>
                  <label htmlFor="edit-item-season" style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: "6px" }}>Season</label>
                  <select
                    id="edit-item-season"
                    name="edit_item_season"
                    value={editSeason}
                    onChange={e => setEditSeason(e.target.value)}
                    className="input"
                    style={{ padding: "8px 12px", fontSize: "14px", textTransform: "capitalize" }}
                  >
                    {editSeasonOptions.map((option) => (
                      <option key={option.value} value={option.value} style={{ textTransform: "capitalize" }}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="edit-item-formality" style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: "6px" }}>Dress Code</label>
                  <select
                    id="edit-item-formality"
                    name="edit_item_formality"
                    value={editFormalityLabel}
                    onChange={e => setEditFormalityLabel(e.target.value)}
                    className="input"
                    style={{ padding: "8px 12px", fontSize: "14px" }}
                  >
                    {editFormalityOptions.map((option) => (
                      <option key={option.label} value={option.label}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

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

              {(() => {
                const allDescriptors = getDescriptorOptionsForCategory(editCat, editDescriptors);
                if (!Object.keys(allDescriptors).length) return null;
                return (
                  <div>
                    <StyleDetailsSection
                      allDescriptors={allDescriptors}
                      descriptors={editDescriptors}
                      onDescriptorChange={(key, val) =>
                        setEditDescriptors((prev) => ({ ...prev, [key]: val }))
                      }
                    />
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: "8px", flexShrink: 0, background: "var(--surface)" }}>
          <button
            onClick={() => onSave(editCat, editColor, editPattern, editSeason, editFormalityLabel, editDescriptors)}
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
          {getItemDisplayName(item)}
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

function PermanentDeleteDialog({
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
        width: "min(380px, 92vw)", padding: "22px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.25)",
      }}>
        <p style={{ fontWeight: 600, fontSize: "16px", color: "var(--charcoal)", marginBottom: "8px" }}>
          Delete this archived item forever?
        </p>
        <p style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "18px", textTransform: "capitalize" }}>
          {getItemDisplayName(item)}
        </p>
        <p style={{ color: "var(--muted)", fontSize: "13px", lineHeight: 1.5, marginBottom: "18px" }}>
          This will remove the record and associated media permanently. You will not be able to restore it.
        </p>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={onConfirm}
            style={{ padding: "8px 16px", borderRadius: "6px", border: "none", background: "#B91C1C", color: "#FFF7ED", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
          >
            Delete forever
          </button>
        </div>
      </div>
    </>
  );
}

function ActivePermanentDeleteDialog({
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
        width: "min(380px, 92vw)", padding: "22px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.25)",
      }}>
        <p style={{ fontWeight: 600, fontSize: "16px", color: "var(--charcoal)", marginBottom: "8px" }}>
          Delete this item forever?
        </p>
        <p style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "18px", textTransform: "capitalize" }}>
          {getItemDisplayName(item)}
        </p>
        <p style={{ color: "var(--muted)", fontSize: "13px", lineHeight: 1.5, marginBottom: "18px" }}>
          This will remove the item and associated media immediately. It will not be moved to archive and cannot be restored.
        </p>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={onConfirm}
            style={{ padding: "8px 16px", borderRadius: "6px", border: "none", background: "#B91C1C", color: "#FFF7ED", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
          >
            Delete forever
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

function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "80px 24px", color: "var(--muted)" }}>
      <ShirtIcon size={48} color="var(--border)" style={{ margin: "0 auto 16px", display: "block" }} />
      <h3 className="type-section-title" style={{ fontFamily: "Playfair Display, serif", color: "var(--charcoal)", marginBottom: "8px" }}>Your wardrobe is empty</h3>
      <p className="type-body" style={{ fontSize: "15px" }}>
        Your next add starts in{" "}
        <Link
          href="/batch-upload"
          style={{ color: "var(--gold)", textDecoration: "none", fontWeight: 600 }}
        >
          Batch Upload
        </Link>
        .
      </p>
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
