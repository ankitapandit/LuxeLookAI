/**
 * utils/wardrobeHelpers.ts
 * ========================
 * Shared wardrobe constants and pure helpers used by both wardrobe.tsx
 * and the batch upload review flow.  No React dependencies.
 */

// ── Color palette ────────────────────────────────────────────────────────────

export const SOLID_COLORS: { key: string; hex: string; label: string }[] = [
  { key: "black",      hex: "#1a1a1a",  label: "Black"      },
  { key: "white",      hex: "#f5f5f0",  label: "White"      },
  { key: "navy",       hex: "#1e2f5e",  label: "Navy"       },
  { key: "beige",      hex: "#c8a97e",  label: "Beige"      },
  { key: "red",        hex: "#c0392b",  label: "Red"        },
  { key: "green",      hex: "#4a7c59",  label: "Green"      },
  { key: "grey",       hex: "#9e9e9e",  label: "Grey"       },
  { key: "brown",      hex: "#7d5a3c",  label: "Brown"      },
  { key: "pink",       hex: "#e8a0a0",  label: "Pink"       },
  { key: "blue",       hex: "#4a90c4",  label: "Blue"       },
  { key: "yellow",     hex: "#d4a843",  label: "Yellow"     },
  { key: "orange",     hex: "#d4703a",  label: "Orange"     },
  { key: "purple",     hex: "#7c5cbf",  label: "Purple"     },
  {
    key: "multicolor",
    hex: "linear-gradient(135deg, #c0392b 0%, #d4a843 24%, #4a7c59 48%, #4a90c4 72%, #7c5cbf 100%)",
    label: "Multicolor",
  },
];

// ── Formality helpers ────────────────────────────────────────────────────────

export function getFormalityEditLabel(score: number | undefined): string {
  if (score === undefined || score === null) return "";
  if (score >= 0.85) return "Black Tie";
  if (score >= 0.78) return "Cocktail";
  if (score >= 0.68) return "Business Formal";
  if (score >= 0.55) return "Business Casual";
  if (score >= 0.42) return "Smart Casual";
  if (score >= 0.20) return "Casual";
  return "Loungewear";
}

// ── Preset color normalisation ───────────────────────────────────────────────

export function normalizeToPresetKey(color: string): string | null {
  if (!color) return null;
  if (color.startsWith("#")) return null;
  if (SOLID_COLORS.some((c) => c.key === color)) return color;
  const lower = color.toLowerCase();
  const overrides: Record<string, string> = {
    multicolor: "multicolor", "multi color": "multicolor", "multi-colour": "multicolor",
    charcoal: "black", ebony: "black", "jet black": "black", onyx: "black",
    ivory: "white", "off white": "white", cream: "white", snow: "white",
    "midnight blue": "navy", "dark blue": "navy", indigo: "navy",
    camel: "beige", tan: "beige", khaki: "beige", sand: "beige",
    crimson: "red", scarlet: "red", maroon: "red", burgundy: "red",
    sage: "green", olive: "green", "forest green": "green", "lime green": "green",
    "dark grey": "grey", "light grey": "grey", silver: "grey",
    "chocolate brown": "brown", "dark brown": "brown",
    blush: "pink", "dusty rose": "pink", "hot pink": "pink",
    "sky blue": "blue", "light blue": "blue", "royal blue": "blue", teal: "blue",
    "light yellow": "yellow", gold: "yellow",
    "dark orange": "orange", peach: "orange", coral: "orange",
    "dark violet": "purple", plum: "purple", violet: "purple", lavender: "purple",
  };
  if (overrides[lower]) return overrides[lower];
  for (const c of [...SOLID_COLORS].sort((a, b) => b.key.length - a.key.length)) {
    if (lower.includes(c.key)) return c.key;
  }
  return null;
}

// ── Descriptor utilities ─────────────────────────────────────────────────────

const FABRIC_OPTIONS = [
  "cotton","polyester","nylon","spandex","elastane","rayon","linen","denim",
  "satin","silk","chiffon","mesh","lace","knit","ribbed","wool","leather",
  "suede","faux fur","tweed","jersey","terry","lycra","recycled nylon","fleece",
  "modal","bamboo","waffle-knit",
] as const;

export const CATEGORY_DESCRIPTORS: Record<string, Record<string, string[]>> = {
  tops: {
    fabric_type:   [...FABRIC_OPTIONS],
    warmth:        ["airy","light","medium","warm","thermal"],
    neckline:      ["crew","round","boat","V-neck","plunging","jewel","square","scoop","sweetheart","off-shoulder","strapless","halter","high neck","turtleneck","collar","cowl","one shoulder"],
    sleeve_length: ["sleeveless","cap","short","3/4","long"],
    fit:           ["slim","regular","relaxed","loose","oversized","bodycon","tailored","A-line","fit & flare","wrap"],
    length:        ["crop","regular","longline"],
    closure:       ["pullover","button-front","zip-up","wrap","open front"],
    detailing:     ["ruffles","pleats","ruched","smocked","tiered","draped","cut-out","slit","bow","knot","lace-up","fringe","embroidery"],
    pattern:       ["solid","floral","striped","graphic","abstract","tie-dye","plaid","animal print"],
  },
  dresses: {
    fabric_type:   [...FABRIC_OPTIONS],
    warmth:        ["airy","light","medium","warm","thermal"],
    neckline:      ["crew","round","boat","V-neck","plunging","jewel","square","scoop","sweetheart","off-shoulder","strapless","halter","high neck","turtleneck","collar","cowl","one shoulder"],
    sleeve_length: ["sleeveless","cap","short","3/4","long"],
    fit:           ["slim","regular","relaxed","loose","oversized","bodycon","tailored","A-line","fit & flare","wrap"],
    length:        ["crop","regular","longline","mini","midi","maxi"],
    detailing:     ["ruffles","pleats","ruched","smocked","tiered","draped","cut-out","slit","bow","knot","lace-up","fringe","embroidery"],
    pattern:       ["solid","floral","striped","graphic","abstract","tie-dye","plaid","animal print"],
  },
  jumpsuits: {
    fabric_type:    [...FABRIC_OPTIONS],
    jumpsuit_style: ["tailored","utility","romper","playsuit","halter","strapless","boiler","evening","boho","wide-leg","straight-leg","tapered"],
    neckline:       ["crew","round","boat","V-neck","plunging","jewel","square","scoop","sweetheart","off-shoulder","strapless","halter","high neck","turtleneck"],
    sleeve_length:  ["sleeveless","cap","short","3/4","long"],
    fit:            ["slim","regular","relaxed","oversized","tailored","belted"],
    pattern:        ["solid","floral","striped","graphic","abstract","tie-dye","plaid","animal print"],
  },
  outerwear: {
    outerwear_type: ["blazer","jacket","coat","trench","cardigan","bomber","puffer","shacket","cape","vest","shrug","coverup"],
    fabric_type:    [...FABRIC_OPTIONS],
    warmth:         ["airy","light","medium","warm","thermal"],
    fit:            ["tailored","slim","regular","relaxed","boxy","oversized"],
    length:         ["cropped","waist","hip","thigh","knee","midi","longline"],
    closure:        ["open front","single-breasted","double-breasted","zip-up","toggle","belted","snap"],
    pattern:        ["solid","floral","striped","graphic","abstract","tie-dye","plaid","animal print"],
  },
  bottoms: {
    fabric_type:     [...FABRIC_OPTIONS],
    waist_position:  ["high","mid","low","drop","empire"],
    fit:             ["slim","straight","relaxed","loose","wide-leg","flared"],
    length:          ["shorts","mini","midi","maxi","capri","ankle","full-length"],
    pattern:         ["solid","plaid","striped","floral"],
  },
  shoes: {
    shoe_type:   ["heels","sneakers","sandals","boots","flats","loafers","pumps","mules","platforms","mary janes"],
    toe_shape:   ["round","pointed","square","open-toe","peep-toe"],
    heel_height: ["flat","low","mid","high","platform"],
    closure:     ["slip-on","lace-up","buckle","zip","velcro","strappy"],
    material:    ["leather","suede","canvas","synthetic","fabric"],
    pattern:     ["solid","animal print","textured","colorblock"],
  },
  jewelry: {
    jewelry_type: ["necklace","earrings","bracelet","ring","watch","anklet","brooch","cuff"],
    metal:        ["gold","silver","rose gold","platinum","mixed metal"],
    style:        ["delicate","minimal","statement","sculptural","classic","vintage","embellished"],
  },
  accessories: {
    accessory_type: ["handbag","tote","clutch","backpack","crossbody","belt","scarf","hat","sunglasses","headband","hair clip","claw clip","barrette","scrunchie","ribbon","hair scarf"],
    size:           ["mini","small","medium","large","oversized"],
    material:       ["leather","fabric","straw","metal","synthetic","satin","silk","velvet","plastic","pearl"],
    style:          ["structured","slouchy","minimalist","embellished","logo","classic","playful","statement"],
  },
  set: {
    fabric_type:  [...FABRIC_OPTIONS],
    top_style:    ["crop","halter","bandeau","off-shoulder","bralette","corset","blazer","shirt","camisole"],
    bottom_style: ["shorts","mini skirt","midi skirt","maxi skirt","trousers","wide-leg trousers"],
    fit:          ["slim","regular","relaxed","oversized","tailored","wrap","bodycon","A-line"],
    pattern:      ["solid","floral","striped","plaid","abstract","animal print","geometric","tie-dye","color-block"],
  },
  swimwear: {
    swimwear_style:  ["bikini","one-piece","tankini","monokini","swim dress","rash guard","swim shorts","boardshorts","bandeau","triangle","halter","balconette","sporty"],
    coverage_level:  ["minimal","moderate","full"],
    cut:             ["high-leg","cheeky","high-waist","boyshort","brief","thong","string","skirted"],
    fabric_type:     ["nylon","polyester","spandex","elastane","lycra","recycled nylon"],
  },
  loungewear: {
    fabric_type: [...FABRIC_OPTIONS],
    warmth:      ["airy","light","medium","warm","thermal"],
    fit:         ["slim","regular","relaxed","loose","oversized"],
    pattern:     ["solid","striped","graphic","plaid"],
  },
};

export function getDescriptorOptionsForCategory(
  category: string,
  existingDescriptors: Record<string, string> = {}
): Record<string, string[]> {
  const catKey = category.toLowerCase().replace(/\s+/g, "");
  const catDescriptors = CATEGORY_DESCRIPTORS[catKey] || {};
  const merged: Record<string, string[]> = {};
  for (const [key, vals] of Object.entries(catDescriptors)) {
    merged[key] = [...vals];
  }
  // Inject any existing values that aren't in the preset options
  for (const [key, value] of Object.entries(existingDescriptors)) {
    if (!value || !merged[key]) continue;
    if (!merged[key].includes(value)) merged[key] = Array.from(new Set([...merged[key], value]));
  }
  return merged;
}

export function sanitizeDescriptorsForCategory(
  category: string,
  descriptors: Record<string, string> = {}
): Record<string, string> {
  const allowed = getDescriptorOptionsForCategory(category, {});
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(descriptors)) {
    if (!value || !allowed[key]) continue;
    next[key] = value;
  }
  return next;
}

export function formatDescriptorLabel(key: string): string {
  return key.replace(/_/g, " ");
}
