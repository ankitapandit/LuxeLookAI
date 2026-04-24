/**
 * utils/outfitBackground.ts
 * =========================
 * Dynamic moodboard background generator.
 *
 * Analyses outfit item colours, patterns, and formality to select the most
 * contextually appropriate background from a curated palette library, then
 * compiles the result into ready-to-use CSS strings.
 *
 * Selector:
 *   background = f(color_palette, saturation, temperature, contrast_goal, aesthetic_mood)
 *
 * Usage:
 *   const bg = getOutfitBackground(items, card);
 *   <div style={{ background: bg.stage }} />
 *   <div style={{ backgroundImage: bg.textureOverlay }} />  // absolute overlay div
 */

import { ClothingItem, OutfitCard } from "@/services/api";

// ── Palette library ───────────────────────────────────────────────────────────

export interface BackgroundPreset {
  name         : string;
  base         : string;   // primary stage colour
  accent       : string;   // secondary / gradient endpoint
  shellTint    : string;   // slightly deeper, for outer card shell
  gradientType : GradientType;
  textureToken : TextureToken;
  isDark       : boolean;  // true → use light text on top of this background
}

type GradientType =
  | "soft-diagonal"
  | "subtle-vertical"
  | "radial-glow"
  | "low-contrast-linear"
  | "cool-vertical"
  | "warm-radial"
  | "spotlight-radial"
  | "shadowed";

type TextureToken =
  | "matte-smooth"
  | "soft-paper"
  | "linen"
  | "satin-glow"
  | "velvet"
  | "canvas"
  | "marble-soft"
  | "grain-blur";

const PALETTE_LIBRARY: Record<string, BackgroundPreset> = {
  "warm-ivory": {
    name: "Warm Ivory", base: "#FAF6F0", accent: "#EFE7DD", shellTint: "#F2EDE5",
    gradientType: "soft-diagonal", textureToken: "soft-paper", isDark: false,
  },
  "blush-nude": {
    name: "Blush Nude", base: "#F7E7E1", accent: "#EED6CF", shellTint: "#EDDBCF",
    gradientType: "soft-diagonal", textureToken: "linen", isDark: false,
  },
  "soft-beige": {
    name: "Soft Beige", base: "#F5EDE6", accent: "#E3D6CA", shellTint: "#EBE2D8",
    gradientType: "subtle-vertical", textureToken: "soft-paper", isDark: false,
  },
  "champagne": {
    name: "Champagne", base: "#F3E9DC", accent: "#D9C7B2", shellTint: "#E9DDD0",
    gradientType: "radial-glow", textureToken: "satin-glow", isDark: false,
  },
  "cool-mist": {
    name: "Cool Mist", base: "#F2F4F7", accent: "#DDE3EA", shellTint: "#E6EAF0",
    gradientType: "cool-vertical", textureToken: "matte-smooth", isDark: false,
  },
  "sage-wash": {
    name: "Sage Wash", base: "#EAF1EC", accent: "#D5E1D8", shellTint: "#E0EBE4",
    gradientType: "warm-radial", textureToken: "linen", isDark: false,
  },
  "dusty-lavender": {
    name: "Dusty Lavender", base: "#EEE7F3", accent: "#D8CBE5", shellTint: "#E4DBF0",
    gradientType: "soft-diagonal", textureToken: "soft-paper", isDark: false,
  },
  "taupe-editorial": {
    name: "Taupe Editorial", base: "#D8CEC4", accent: "#B8AAA0", shellTint: "#C8BEB4",
    gradientType: "subtle-vertical", textureToken: "matte-smooth", isDark: false,
  },
  "charcoal-glow": {
    name: "Charcoal Glow", base: "#2E2E2E", accent: "#4A403B", shellTint: "#242424",
    gradientType: "spotlight-radial", textureToken: "velvet", isDark: true,
  },
  "espresso-silk": {
    name: "Espresso Silk", base: "#2A1F1B", accent: "#5A4036", shellTint: "#1E1714",
    gradientType: "radial-glow", textureToken: "satin-glow", isDark: true,
  },
};

// ── Signal detection ──────────────────────────────────────────────────────────

const _WARM_FAMILY    = ["red", "orange", "yellow", "gold", "coral", "rust", "tan", "camel", "brown", "peach", "copper", "amber", "terracotta", "burgundy"];
const _COOL_FAMILY    = ["blue", "navy", "teal", "mint", "grey", "gray", "silver", "purple", "lavender", "lilac", "violet", "indigo"];
const _NEUTRAL_COLORS = ["black", "white", "beige", "cream", "ivory", "nude", "sand", "ecru", "off-white", "stone", "parchment"];
const _PASTEL_COLORS  = ["blush", "lavender", "lilac", "mint", "baby blue", "soft pink", "powder", "dusty rose", "mauve", "pale", "pastel"];
const _DARK_COLORS    = ["black", "charcoal", "espresso", "dark brown", "oxblood", "midnight", "dark grey", "dark gray", "ebony", "onyx"];
const _EARTHY_COLORS  = ["olive", "sage", "moss", "khaki", "army", "forest", "earthy", "clay", "camo", "fern", "grass"];
const _PURPLE_FAMILY  = ["purple", "lavender", "lilac", "violet", "plum", "mauve", "grape", "amethyst", "periwinkle"];
const _GREEN_FAMILY   = ["green", "sage", "olive", "mint", "forest", "emerald", "jade"];
const _PINK_FAMILY    = ["pink", "blush", "rose", "dusty rose", "mauve", "peony", "bubblegum", "fuchsia", "hot pink", "petal"];
const _BOLD_VIVID     = ["neon", "electric", "vivid", "bright red", "cobalt", "chartreuse", "lime green", "fuchsia"];

function _matchesAny(color: string, family: string[]): boolean {
  return family.some((f) => color.includes(f));
}

interface ColorSignals {
  warmCount    : number;
  coolCount    : number;
  neutralCount : number;
  darkCount    : number;
  total        : number;
  hasPastel    : boolean;
  hasFloral    : boolean;
  hasEarthy    : boolean;
  hasPurple    : boolean;
  hasGreen     : boolean;
  hasPink      : boolean;
  hasWhite     : boolean;
  hasBlack     : boolean;
  hasBoldVivid : boolean;
  avgFormality : number;
  dominantTemp : "warm" | "cool" | "neutral";
}

function detectColorSignals(items: ClothingItem[]): ColorSignals {
  const colors  = items.map((i) => (i.color   || "").toLowerCase().trim()).filter(Boolean);
  const patterns = items.map((i) => (i.pattern || "").toLowerCase().trim()).filter(Boolean);

  let warmCount = 0, coolCount = 0, neutralCount = 0, darkCount = 0;
  let hasPastel = false, hasEarthy = false, hasPurple = false;
  let hasGreen = false, hasPink = false, hasWhite = false;
  let hasBlack = false, hasBoldVivid = false;

  for (const c of colors) {
    if (_matchesAny(c, _DARK_COLORS))    darkCount++;
    if (_matchesAny(c, _WARM_FAMILY))    warmCount++;
    if (_matchesAny(c, _COOL_FAMILY))    coolCount++;
    if (_matchesAny(c, _NEUTRAL_COLORS)) neutralCount++;
    if (_matchesAny(c, _PASTEL_COLORS))  hasPastel    = true;
    if (_matchesAny(c, _EARTHY_COLORS))  hasEarthy    = true;
    if (_matchesAny(c, _PURPLE_FAMILY))  hasPurple    = true;
    if (_matchesAny(c, _GREEN_FAMILY))   hasGreen     = true;
    if (_matchesAny(c, _PINK_FAMILY))    hasPink      = true;
    if (_matchesAny(c, _BOLD_VIVID))     hasBoldVivid = true;
    if (c.includes("white") || c.includes("ivory") || c.includes("cream") || c.includes("ecru")) hasWhite = true;
    if (c.includes("black") || c.includes("charcoal") || c.includes("ebony"))                   hasBlack = true;
  }

  const hasFloral = patterns.some((p) =>
    p.includes("floral") || p.includes("botanical") || p.includes("ditsy") || p.includes("paisley")
  );

  const avgFormality = items.length
    ? items.reduce((sum, i) => sum + (i.formality_score ?? 0.45), 0) / items.length
    : 0.45;

  const dominantTemp: "warm" | "cool" | "neutral" =
    warmCount > coolCount ? "warm" : coolCount > warmCount ? "cool" : "neutral";

  return {
    warmCount, coolCount, neutralCount, darkCount,
    total: colors.length || 1,
    hasPastel, hasFloral, hasEarthy,
    hasPurple, hasGreen, hasPink,
    hasWhite, hasBlack, hasBoldVivid,
    avgFormality, dominantTemp,
  };
}

// ── Background selection ──────────────────────────────────────────────────────

/**
 * Select the best BackgroundPreset for the outfit.
 * Priority order — first matching rule wins.
 */
export function selectBackgroundPreset(
  items    : ClothingItem[],
  card    ?: OutfitCard | null,
): BackgroundPreset {
  const s     = detectColorSignals(items);
  const vibe  = (card?.vibe         || "").toLowerCase();
  const story = (card?.color_theory || "").toLowerCase();

  const isLuxeEvening =
    s.avgFormality >= 0.72 ||
    vibe.includes("elegant") ||
    vibe.includes("formal")  ||
    vibe.includes("luxe");

  // 1. Black / dark outfit → dark background
  if (s.hasBlack && s.darkCount / s.total >= 0.5) {
    return s.avgFormality >= 0.65
      ? PALETTE_LIBRARY["espresso-silk"]
      : PALETTE_LIBRARY["charcoal-glow"];
  }

  // 2. Predominantly white / ivory / cream → warm ivory
  if (s.hasWhite && s.neutralCount / s.total >= 0.6 && !s.hasPastel && !s.hasPurple) {
    return PALETTE_LIBRARY["warm-ivory"];
  }

  // 3. Purple / lavender / lilac + floral or pastel → dusty lavender
  if (s.hasPurple && (s.hasFloral || s.hasPastel)) {
    return PALETTE_LIBRARY["dusty-lavender"];
  }
  // Purple without floral → cool-mist (keeps it minimal rather than themed)
  if (s.hasPurple && s.dominantTemp === "cool") {
    return PALETTE_LIBRARY["cool-mist"];
  }

  // 4. Pink / blush + floral or pastel → blush nude
  if (s.hasPink && (s.hasFloral || s.hasPastel)) {
    return PALETTE_LIBRARY["blush-nude"];
  }

  // 5. Earthy / botanical / green dominant → sage wash
  if (s.hasEarthy || (s.hasGreen && !s.hasPurple && !s.hasPink)) {
    return PALETTE_LIBRARY["sage-wash"];
  }

  // 6. Cool dominant (blue / grey / silver) → cool mist
  if (s.dominantTemp === "cool" && !s.hasPurple) {
    return PALETTE_LIBRARY["cool-mist"];
  }

  // 7. Luxe evening (high formality, warm tones) → champagne / taupe
  if (isLuxeEvening && s.dominantTemp !== "cool") {
    return s.avgFormality >= 0.80
      ? PALETTE_LIBRARY["taupe-editorial"]
      : PALETTE_LIBRARY["champagne"];
  }

  // 8. Bold / vivid colour-block → soft beige (neutral lets outfit pop)
  if (s.hasBoldVivid || story.includes("pop")) {
    return PALETTE_LIBRARY["soft-beige"];
  }

  // 9. Warm-dominant neutral → soft beige
  if (s.dominantTemp === "warm" && s.neutralCount > 0) {
    return PALETTE_LIBRARY["soft-beige"];
  }

  // 10. Default
  return PALETTE_LIBRARY["warm-ivory"];
}

// ── CSS builders ─────────────────────────────────────────────────────────────

function buildGradientCSS(preset: BackgroundPreset): string {
  const { base, accent, gradientType } = preset;
  switch (gradientType) {
    case "soft-diagonal":
      return `linear-gradient(135deg, ${base} 30%, ${accent} 100%)`;
    case "subtle-vertical":
      return `linear-gradient(180deg, ${base} 0%, ${accent} 100%)`;
    case "radial-glow":
      return `radial-gradient(ellipse at 50% 30%, ${base} 0%, ${accent} 100%)`;
    case "low-contrast-linear":
      return `linear-gradient(120deg, ${base} 60%, ${accent} 100%)`;
    case "cool-vertical":
      return `linear-gradient(170deg, ${base} 0%, ${accent} 100%)`;
    case "warm-radial":
      return `radial-gradient(ellipse at 40% 30%, ${base} 0%, ${accent} 100%)`;
    case "spotlight-radial":
      // Dark background with a lighter centre
      return `radial-gradient(ellipse at 50% 20%, ${accent} 0%, ${base} 100%)`;
    case "shadowed":
      return `linear-gradient(160deg, ${base} 40%, ${accent} 100%)`;
    default:
      return base;
  }
}

/**
 * Returns a `backgroundImage` CSS string for the texture overlay div.
 * The overlay sits as `position: absolute; inset: 0; pointerEvents: none`
 * above the stage background and below the items.
 */
function buildTextureOverlayCSS(textureToken: TextureToken, isDark: boolean): string {
  const warmRGB = isDark ? "255,255,255" : "180,140,100";
  const a       = isDark ? 0.08          : 0.12;

  switch (textureToken) {
    case "soft-paper":
      return [
        `radial-gradient(ellipse at 15% 20%, rgba(${warmRGB},${a}) 0%, transparent 52%)`,
        `radial-gradient(ellipse at 80% 75%, rgba(${warmRGB},${a * 0.55}) 0%, transparent 46%)`,
      ].join(", ");

    case "linen":
      return [
        `repeating-linear-gradient(45deg, transparent, transparent 18px, rgba(${warmRGB},0.022) 18px, rgba(${warmRGB},0.022) 19px)`,
        `radial-gradient(ellipse at 20% 15%, rgba(${warmRGB},${a * 0.7}) 0%, transparent 55%)`,
      ].join(", ");

    case "satin-glow":
      return [
        `linear-gradient(180deg, rgba(255,255,255,0.20) 0%, transparent 38%)`,
        `radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.16) 0%, transparent 60%)`,
      ].join(", ");

    case "velvet":
      return `radial-gradient(ellipse at 50% 30%, rgba(80,60,40,0.16) 0%, transparent 70%)`;

    case "canvas":
      return [
        `repeating-linear-gradient(90deg, transparent, transparent 22px, rgba(140,110,70,0.016) 22px, rgba(140,110,70,0.016) 23px)`,
        `repeating-linear-gradient( 0deg, transparent, transparent 22px, rgba(140,110,70,0.016) 22px, rgba(140,110,70,0.016) 23px)`,
      ].join(", ");

    case "marble-soft":
      return [
        `linear-gradient(118deg, rgba(255,255,255,0.18) 0%, transparent 40%)`,
        `radial-gradient(ellipse at 70% 60%, rgba(200,190,180,0.12) 0%, transparent 50%)`,
      ].join(", ");

    case "grain-blur":
      return `radial-gradient(ellipse at 30% 20%, rgba(${warmRGB},0.10) 0%, transparent 60%)`;

    case "matte-smooth":
    default:
      return "none";
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface OutfitBackgroundOutput {
  /** CSS `background` value for the outer card shell */
  shell        : string;
  /** CSS `background` value for the stage (flatlay area) */
  stage        : string;
  /** CSS `backgroundImage` for a texture overlay div sitting above the stage */
  textureOverlay: string;
  /** true when the background is dark — flip text colours to light */
  isDark       : boolean;
  /** Resolved preset name (useful for debugging / analytics) */
  presetName   : string;
  /** Primary title colour adjusted for background luminosity */
  titleColor   : string;
  /** Secondary / subhead colour adjusted for background luminosity */
  subheadColor : string;
  /** Subtle border colour that complements the background */
  borderColor  : string;
}

export function getOutfitBackground(
  items : ClothingItem[],
  card ?: OutfitCard | null,
): OutfitBackgroundOutput {
  const preset = selectBackgroundPreset(items, card);

  const titleColor    = preset.isDark ? "#F0EBE2" : "#241B10";
  const subheadColor  = preset.isDark ? "#C8B89A" : "#705B43";
  const borderColor   = preset.isDark
    ? "rgba(255,255,255,0.08)"
    : "rgba(0,0,0,0.07)";

  return {
    shell         : preset.shellTint,
    stage         : buildGradientCSS(preset),
    textureOverlay: buildTextureOverlayCSS(preset.textureToken, preset.isDark),
    isDark        : preset.isDark,
    presetName    : preset.name,
    titleColor,
    subheadColor,
    borderColor,
  };
}
