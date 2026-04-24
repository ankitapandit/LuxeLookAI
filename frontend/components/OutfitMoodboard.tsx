import { useState } from "react";
import Image from "next/image";
import { ClothingItem, OutfitCard } from "@/services/api";
import { getDisplayColorName, getItemDisplayName } from "@/utils/itemDisplay";
import { getOutfitBackground } from "@/utils/outfitBackground";
import { useImageContentBounds, getInnerWrapperStyle } from "@/utils/useImageContentBounds";

function shouldBypassImageOptimization(src: string): boolean {
  return src.startsWith("blob:") || src.startsWith("data:");
}

function parseColorSwatch(color?: string): { label: string; swatch: string } | null {
  if (!color) return null;
  if (color.startsWith("#")) return { label: color.toUpperCase(), swatch: color };

  const preset: Record<string, string> = {
    black: "#171717",
    white: "#F5F0E8",
    navy: "#23386B",
    beige: "#D0B38D",
    red: "#C94735",
    green: "#5C8762",
    grey: "#A7A7A7",
    gray: "#A7A7A7",
    brown: "#8A6644",
    pink: "#E7A2A6",
    blue: "#599CD5",
    yellow: "#D9AE43",
    orange: "#D77A3A",
    purple: "#8162C9",
    cream: "#EEE3D1",
    tan: "#C49A6C",
    olive: "#71825A",
    gold: "#C6A25A",
    silver: "#C6C6C6",
    multicolor: "linear-gradient(135deg, #C94735 0%, #D9AE43 24%, #5C8762 48%, #599CD5 72%, #8162C9 100%)",
  };

  const normalized = color.toLowerCase().trim();
  if (preset[normalized]) return { label: color, swatch: preset[normalized] };
  const matched = Object.keys(preset).find((key) => normalized.includes(key));
  return matched ? { label: color, swatch: preset[matched] } : null;
}

function getItemHoverLabel(item: ClothingItem): string {
  const color = getDisplayColorName(item.color);
  const name = getItemDisplayName(item);
  return color ? `${name} · ${color}` : name;
}

function getImageSrc(item: ClothingItem, imageMode: "cutout" | "upload"): string {
  if (imageMode === "upload") {
    return item.thumbnail_url || item.image_url || item.cutout_url || "";
  }
  return item.cutout_url || item.thumbnail_url || item.image_url || "";
}

type StagePlacement = {
  item: ClothingItem;
  left: string;
  top: string;
  width: string;
  height: string;
  rotation?: string;
  zIndex?: number;
};

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getRotation(itemId: string, base: number): string {
  // Flat-lay feel: gentle variance, max ±2° around the base
  const offset = (hashString(itemId) % 5) - 2;
  return `${base + offset}deg`;
}

function getStageSafeTop(compact: boolean, expanded: boolean): number {
  if (compact) return 12;
  if (expanded) return 14;
  return 13;
}

function getStageSafeRight(compact: boolean, expanded: boolean, hasPalette: boolean): number {
  if (!hasPalette) return compact ? 4 : expanded ? 5 : 4;
  if (compact) return 8;
  if (expanded) return 10;
  return 9;
}

// ─── Stitch-style grid placement ─────────────────────────────────────────────
// Fixed zone rules:
//
//  ┌──────────────────┬──────────────────┐
//  │  LEFT COLUMN     │  TOP-RIGHT       │
//  │  main garment    │  outerwear       │
//  │  (dress / set /  │                  │
//  │   top + bottom)  ├──────────────────┤
//  │  + shoes below   │  BOTTOM-RIGHT    │
//  │                  │  accessories /   │
//  │                  │  jewelry         │
//  └──────────────────┴──────────────────┘
//
// Graceful fallback when zones are empty:
//   – No outerwear  → accessories span full right column (stacked vertically)
//   – No accessories → outerwear spans full right column
//   – top + bottom   → each takes ~40% of left height; shoes squeezed to 12% at bottom

/**
 * Proportional stitch layout (clean 2-column grid, no rotation).
 *
 * LEFT column  — hero garment + shoes below it, each at their natural height.
 * RIGHT column — outerwear on top, then accessories, each at natural height.
 *
 * Items within each column are stacked via stackColumn() so their relative
 * heights are always to-scale even when compositions vary.  Shoes are always
 * visually smaller than the hero; accessories are clearly smaller than outerwear.
 */
function getStitchPlacements(
  items: ClothingItem[],
  options?: { safeTop?: number; safeRight?: number },
): StagePlacement[] {
  // Stitch stage aspect ratio is 3:4 = 0.75
  const stageAR = 0.75;
  const G    = 3;    // gutter / margin %
  const safeTop = options?.safeTop ?? 0;
  const safeRight = options?.safeRight ?? 0;
  const LW   = 44;   // left column width
  const RW   = Math.max(32, 44 - safeRight);   // right column width
  const RL   = 53;   // right column left
  const topOffset = G + safeTop;
  const AVAIL = 100 - G - topOffset; // available height (%)

  const fullLook  = items.find(i => ["dresses","set","swimwear","loungewear","jumpsuits"].includes(i.category));
  const top       = items.find(i => i.category === "tops");
  const bottom    = items.find(i => i.category === "bottoms");
  const outerwear = items.find(i => i.category === "outerwear");
  const shoes     = items.find(i => i.category === "shoes");
  const accList   = items.filter(i => ["accessories","jewelry"].includes(i.category));

  const placements: StagePlacement[] = [];

  // ── Left column: hero (or top+bottom) stacked with shoes at natural height ─
  const leftGarments: StackItem[] = fullLook
    ? [{ item: fullLook, ns: getNaturalSize(fullLook.category), zIndex: 3 }]
    : [
        ...(top    ? [{ item: top,    ns: getNaturalSize("tops"),    zIndex: 4 }] : []),
        ...(bottom ? [{ item: bottom, ns: getNaturalSize("bottoms"), zIndex: 3 }] : []),
      ];

  const leftStack: StackItem[] = [
    ...leftGarments,
    ...(shoes ? [{ item: shoes, ns: getNaturalSize("shoes"), zIndex: 4 }] : []),
  ];
  placements.push(...stackColumn(leftStack, G, LW, AVAIL, topOffset, stageAR, G));

  // ── Right column: outerwear + accessories at natural heights ───────────────
  const usedIds   = new Set(placements.map(p => p.item.id));
  const accToShow = accList.filter(i => !usedIds.has(i.id));

  const rightStack: StackItem[] = [
    ...(outerwear ? [{ item: outerwear, ns: getNaturalSize("outerwear"), zIndex: 3 }] : []),
    ...accToShow.slice(0, 3).map(a => ({ item: a, ns: getNaturalSize(a.category), zIndex: 3 })),
  ];
  placements.push(...stackColumn(rightStack, RL, RW, AVAIL, topOffset, stageAR, G));

  return placements;
}

// ── Proportional natural sizing ───────────────────────────────────────────────
//
// Instead of hardcoding zone dimensions, every category has a natural height
// (as a fraction of the stage height) and a natural width-to-height aspect ratio.
// These values reflect real-world garment proportions so items look to-scale
// relative to each other: a dress is ~4× taller than a pair of shoes, a bag is
// visually smaller than a top, jewelry is clearly the smallest element, etc.
//
// Layout engine:
//  1. The hero (or top+bottom) anchors the LEFT column at its natural height.
//  2. Supporting items fill the RIGHT column, stacked proportionally.
//     - Total natural height is computed, then all items are scaled uniformly
//       so the stack fits the available column height.
//     - Relative proportions between items are always preserved.
//  3. Item widths are derived from their scaled height × natural aspect / stageAR.
//     (stageAR = stage width ÷ stage height, used to convert real-world
//      proportions into CSS percentage space.)

type NaturalSize = { heightFrac: number; aspect: number };

const NATURAL_SIZES: Partial<Record<string, NaturalSize>> = {
  // Hero — full-length garments; tall and narrow
  dresses:    { heightFrac: 0.86, aspect: 0.42 },
  set:        { heightFrac: 0.83, aspect: 0.46 },
  swimwear:   { heightFrac: 0.79, aspect: 0.44 },
  loungewear: { heightFrac: 0.80, aspect: 0.46 },
  jumpsuits:  { heightFrac: 0.83, aspect: 0.44 },
  // Main — half-body garments; ~half the height of a dress
  tops:       { heightFrac: 0.43, aspect: 0.62 },
  bottoms:    { heightFrac: 0.50, aspect: 0.56 },
  // Layer — outerwear; tall but narrower than a dress when spread open
  outerwear:  { heightFrac: 0.66, aspect: 0.56 },
  // Accent — shoes: low-profile and wide (landscape)
  shoes:      { heightFrac: 0.22, aspect: 1.65 },
  // Detail — bags / accessories: compact and slightly landscape
  accessories:{ heightFrac: 0.28, aspect: 1.15 },
  // Micro — jewelry: small, roughly square
  jewelry:    { heightFrac: 0.17, aspect: 0.96 },
};

function getNaturalSize(category: string): NaturalSize {
  return NATURAL_SIZES[category] ?? { heightFrac: 0.35, aspect: 0.75 };
}

type StackItem = { item: ClothingItem; ns: NaturalSize; zIndex?: number };

/**
 * Stack a list of items vertically inside a column, scaling them uniformly so
 * they all fit within `availH` (in %).  Relative heights are preserved.
 *
 * @param its        Items to stack (in top-to-bottom order)
 * @param colL       Left edge of the column (%)
 * @param colW       Column width (%)
 * @param availH     Available height within the column (%)
 * @param topOffset  Starting top position (%)
 * @param stageAR    Stage width ÷ height (used to convert natural aspect → width%)
 * @param GAP        Vertical gap between items (%)
 */
function stackColumn(
  its      : StackItem[],
  colL     : number,
  colW     : number,
  availH   : number,
  topOffset: number,
  stageAR  : number,
  GAP      : number,
): StagePlacement[] {
  if (!its.length) return [];

  // Total natural height including gaps
  const totalNatural =
    its.reduce((s, x) => s + x.ns.heightFrac * 100, 0) +
    Math.max(0, its.length - 1) * GAP;

  // Scale everything down uniformly if it overflows, keep as-is if it fits
  const scale = Math.min(1, availH / totalNatural);

  const result: StagePlacement[] = [];
  let cursor = topOffset;

  for (const { item, ns, zIndex } of its) {
    const h = ns.heightFrac * 100 * scale;
    // Natural width from height × aspect, clamped to column width
    const naturalW = h * ns.aspect / stageAR;
    const w        = Math.min(naturalW, colW);
    // Centre horizontally within the column
    const l        = colL + Math.max(0, (colW - w) / 2);

    result.push({
      item,
      zIndex: zIndex ?? 3,
      left  : `${l.toFixed(1)}%`,
      top   : `${cursor.toFixed(1)}%`,
      width : `${w.toFixed(1)}%`,
      height: `${h.toFixed(1)}%`,
      // Minimal rotation for editorial feel — items stay readable
      rotation: getRotation(item.id, 0),
    });

    cursor += h + GAP * scale;
  }

  return result;
}

/**
 * Proportional flatlay layout for the editorial variant.
 *
 * LEFT column  — hero garment (dress/set) or top + bottom stack.
 *                Width is driven by the hero's natural aspect ratio so the
 *                garment renders at its real-world proportions, not a zone %.
 * RIGHT column — supporting items (outerwear → accessories → shoes) stacked
 *                proportionally.  All items scale together to fill the column;
 *                their relative sizes are always preserved.
 *
 * Shoes are always placed last (bottom of right column) so the look is visually
 * "grounded".  If there is no right-column content, shoes shift to the bottom of
 * the left column area.
 */
function getStagePlacements(items: ClothingItem[], compact: boolean = false, expanded: boolean = false): StagePlacement[] {
  // Stage aspect ratio (width ÷ height).  Drives % width from natural aspect ratio.
  const stageAR = expanded ? 0.80 : 0.75;   // 4:5 expanded, 3:4 otherwise

  const MARGIN = 4;   // % edge margin (top, bottom, left, right)
  const GAP    = 3;   // % vertical gap between stacked items
  const safeTop = getStageSafeTop(compact, expanded);

  const hero      = items.find(i => ["dresses","set","swimwear","loungewear","jumpsuits"].includes(i.category));
  const top       = items.find(i => i.category === "tops");
  const bottom    = items.find(i => i.category === "bottoms");
  const outerwear = items.find(i => i.category === "outerwear");
  const shoes     = items.find(i => i.category === "shoes");
  const details   = items.filter(i => ["accessories","jewelry"].includes(i.category));
  const safeRight = getStageSafeRight(compact, expanded, details.length > 0);
  const topOffset = MARGIN + safeTop;
  const AVAIL  = 100 - MARGIN - topOffset; // usable stage height (%)

  // Promote outerwear to hero when no garments are present
  const outerIsHero = !hero && !top && !bottom && !!outerwear;
  const trueHero    = hero ?? (outerIsHero ? outerwear : null);

  const placements: StagePlacement[] = [];

  // ── Compute left column width from hero's natural proportions ─────────────
  // The hero should occupy roughly the left half of the stage.
  // Derive its natural width% and use that as the left column width so nothing
  // is stretched or squished to fill an arbitrary zone.
  let leftColW: number;

  if (trueHero) {
    const ns    = getNaturalSize(trueHero.category);
    // Natural hero height: fill most of the available height (capped at AVAIL)
    const heroH = Math.min(ns.heightFrac * 100, AVAIL);
    const heroW = Math.min(heroH * ns.aspect / stageAR, 52); // cap at 52% so right col has room
    leftColW    = heroW;

    const heroL = MARGIN + Math.max(0, (leftColW - heroW) / 2);
    const heroT = topOffset + (AVAIL - heroH) / 2;   // vertically centre within safe area

    placements.push({
      item  : trueHero,
      zIndex: 3,
      left  : `${heroL.toFixed(1)}%`,
      top   : `${heroT.toFixed(1)}%`,
      width : `${heroW.toFixed(1)}%`,
      height: `${heroH.toFixed(1)}%`,
      rotation: getRotation(trueHero.id, -1),
    });
  } else {
    // top + bottom stack
    leftColW = 44;
    const leftItems: StackItem[] = [
      ...(top    ? [{ item: top,    ns: getNaturalSize("tops") }]    : []),
      ...(bottom ? [{ item: bottom, ns: getNaturalSize("bottoms") }] : []),
    ];
    placements.push(...stackColumn(leftItems, MARGIN, leftColW, AVAIL, topOffset, stageAR, GAP));
  }

  // ── Right column ──────────────────────────────────────────────────────────
  // Items ordered: outerwear (largest) → accessories → shoes (always last / bottom)
  const rightL = MARGIN + leftColW + GAP;
  const rightW = 100 - rightL - MARGIN - safeRight;

  const rightStack: StackItem[] = [
    // Outerwear — only in right column when there IS a hero in the left col
    ...(outerwear && !outerIsHero ? [{ item: outerwear, ns: getNaturalSize("outerwear"), zIndex: 4 }] : []),
    // Up to 3 accessories / jewelry pieces (smallest items)
    ...details.slice(0, 3).map(a => ({ item: a, ns: getNaturalSize(a.category), zIndex: 3 })),
    // Shoes always anchor the bottom
    ...(shoes ? [{ item: shoes, ns: getNaturalSize("shoes"), zIndex: 3 }] : []),
  ];

  placements.push(...stackColumn(rightStack, rightL, rightW, AVAIL, topOffset, stageAR, GAP));

  // ── Fallback: any items not yet placed ────────────────────────────────────
  const usedIds = new Set(placements.map(p => p.item.id));
  items.filter(i => !usedIds.has(i.id)).slice(0, 2).forEach((item, idx) => {
    const ns = getNaturalSize(item.category);
    const h  = ns.heightFrac * 100 * 0.5;   // half natural size as fallback
    const w  = Math.min(h * ns.aspect / stageAR, rightW);
    placements.push({
      item, zIndex: 2,
      left    : `${(rightL + (rightW - w) / 2).toFixed(1)}%`,
      top     : `${(topOffset + 6 + idx * 24).toFixed(1)}%`,
      width   : `${w.toFixed(1)}%`,
      height  : `${h.toFixed(1)}%`,
      rotation: getRotation(item.id, 0),
    });
  });

  return placements;
}

function StageItem({
  placement,
  expanded,
  compact,
  imageMode,
}: {
  placement: StagePlacement;
  expanded: boolean;
  compact: boolean;
  imageMode: "cutout" | "upload";
}) {
  const imageSrc = getImageSrc(placement.item, imageMode);
  const [hovered, setHovered] = useState(false);
  const leftPct = Number.parseFloat(placement.left);
  const widthPct = Number.parseFloat(placement.width);
  const rightPct = leftPct + widthPct;
  const tooltipPositionStyle: React.CSSProperties =
    leftPct <= 12
      ? { left: 0, transform: "none", textAlign: "left" }
      : rightPct >= 88
        ? { right: 0, left: "auto", transform: "none", textAlign: "right" }
        : { left: "50%", transform: "translateX(-50%)", textAlign: "center" };

  // Measure transparent padding on cutout PNGs so the garment content fills the
  // layout zone rather than the transparent halo eating into the allocated space.
  const bounds = useImageContentBounds(
    imageSrc,
    placement.item.category,
    imageMode === "cutout",
  );
  const innerStyle = getInnerWrapperStyle(bounds);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        left: placement.left,
        top: placement.top,
        width: placement.width,
        height: placement.height,
        zIndex: placement.zIndex ?? 1,
      }}
      title={getItemHoverLabel(placement.item)}
    >
      {/*
        Intermediate clip container — sits flush with the outer div but hides
        the transparent edges that the inner wrapper pushes outside.
        Kept separate from the outer div so the drop-shadow filter and the
        hover tooltip (below) are not affected by overflow:hidden.
      */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: placement.rotation ? `rotate(${placement.rotation})` : undefined,
          transformOrigin: "center center",
          filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.11)) drop-shadow(0 2px 5px rgba(0,0,0,0.07))",
        }}
      >
        <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        {/* Inner wrapper expands beyond the clip container, pushing transparent
            padding outside so the garment content fills the allocated zone. */}
          <div style={innerStyle}>
            <Image
              src={imageSrc}
              alt={getItemDisplayName(placement.item)}
              fill
              unoptimized={shouldBypassImageOptimization(imageSrc)}
              sizes={expanded ? "(max-width: 900px) 55vw, 620px" : compact ? "(max-width: 900px) 44vw, 380px" : "(max-width: 900px) 48vw, 420px"}
              style={{ objectFit: "contain" }}
            />
          </div>
        </div>
      </div>

      {/* Tooltip — sibling to the clip container so it isn't clipped */}
      {hovered && (
        <div
          style={{
            position: "absolute",
            bottom: compact ? "-18px" : expanded ? "-24px" : "-20px",
            maxWidth: compact ? "120px" : expanded ? "190px" : "160px",
            padding: compact ? "5px 8px" : expanded ? "7px 12px" : "6px 10px",
            borderRadius: "999px",
            background: "rgba(24, 23, 20, 0.88)",
            color: "#F4EEE4",
            fontSize: compact ? "10px" : expanded ? "12px" : "11px",
            fontWeight: 500,
            whiteSpace: "normal",
            letterSpacing: "0.01em",
            lineHeight: 1.25,
            boxShadow: "0 8px 18px rgba(0,0,0,0.18)",
            pointerEvents: "none",
            ...tooltipPositionStyle,
          }}
        >
          {getItemHoverLabel(placement.item)}
        </div>
      )}
    </div>
  );
}

export default function OutfitMoodboard({
  items,
  card,
  title,
  expanded = false,
  compact = false,
  imageMode = "cutout",
  variant = "editorial",
}: {
  items: ClothingItem[];
  card?: OutfitCard;
  title: string;
  expanded?: boolean;
  compact?: boolean;
  imageMode?: "cutout" | "upload";
  /** "editorial" — original scatter layout with header above stage (default).
   *  "stitch"    — clean 2×2 grid, no rotation, title label below the image. */
  variant?: "editorial" | "stitch";
}) {
  const palette = items
    .map((item) => parseColorSwatch(item.color))
    .filter((entry): entry is { label: string; swatch: string } => Boolean(entry))
    .filter((entry, index, arr) => arr.findIndex((current) => current.swatch === entry.swatch) === index)
    .slice(0, expanded ? 6 : 4);

  // Dynamic background — derived from outfit colour palette + aesthetic signals
  const bg = getOutfitBackground(items, card);

  // ── Stitch variant ────────────────────────────────────────────────────────
  if (variant === "stitch") {
    const stitchPlacements = getStitchPlacements(items, {
      safeTop: getStageSafeTop(compact, expanded),
      safeRight: getStageSafeRight(compact, expanded, palette.length > 0),
    });

    return (
      <div
        className="moodboard-shell moodboard-stitch"
        style={{
          display: "flex",
          flexDirection: "column",
          borderRadius: compact ? "20px" : expanded ? "28px" : "24px",
          overflow: "hidden",
          background: bg.shell,
          border: `1px solid ${bg.borderColor}`,
          boxShadow: "0 4px 16px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05)",
        }}
      >
        {/* ── Image stage ── */}
        <div
          className="moodboard-stage"
          style={{
            position: "relative",
            aspectRatio: compact ? "3 / 4" : expanded ? "4 / 5" : "3 / 4",
            background: bg.stage,
            overflow: "hidden",
          }}
        >
          {/* Palette-matched texture overlay */}
          {bg.textureOverlay !== "none" && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: bg.textureOverlay,
                pointerEvents: "none",
                zIndex: 1,
              }}
            />
          )}

          <div
            style={{
              position: "absolute",
              top: compact ? "14px" : expanded ? "22px" : "18px",
              left: compact ? "16px" : expanded ? "24px" : "20px",
              right: compact ? "16px" : expanded ? "24px" : "20px",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "12px",
              zIndex: 6,
              pointerEvents: "none",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3
                className="moodboard-title"
                style={{
                  margin: 0,
                  fontSize: compact ? "clamp(16px, 1.9vw, 20px)" : expanded ? "clamp(22px, 2.6vw, 28px)" : "clamp(18px, 2.2vw, 24px)",
                  lineHeight: 1.25,
                  letterSpacing: "0.01em",
                  color: bg.titleColor,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textDecorationLine: "underline",
                  textDecorationThickness: "1px",
                  textUnderlineOffset: "7px",
                }}
              >
                {title}
              </h3>
            </div>

            {palette.length > 0 && (
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                flexShrink: 0,
                padding: compact ? "5px" : "6px",
                borderRadius: compact ? "10px" : "12px",
                background: "rgba(245, 240, 232, 0.15)",
                backdropFilter: "blur(6px)",
                border: "1px solid rgba(205, 191, 171, 0.42)",
                boxShadow: "0 2px 8px rgba(88, 65, 35, 0.08)",
              }}>
                {palette.slice(0, 4).map((swatch) => (
                  <span
                    key={`${swatch.label}-${swatch.swatch}`}
                    title={swatch.label}
                    style={{
                      width: compact ? "12px" : "14px",
                      height: compact ? "12px" : "14px",
                      borderRadius: "999px",
                      background: swatch.swatch,
                      border: "2px solid rgba(255,255,255,0.9)",
                      boxShadow: "0 2px 6px rgba(88, 65, 35, 0.14)",
                      flexShrink: 0,
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {stitchPlacements.map((placement) => (
            <StageItem
              key={placement.item.id}
              placement={placement}
              expanded={expanded}
              compact={compact}
              imageMode={imageMode}
            />
          ))}
        </div>

      </div>
    );
  }

  // ── Editorial variant (original, unchanged) ───────────────────────────────
  const stagePlacements = getStagePlacements(items, compact, expanded);

  return (
    <div
      className="moodboard-shell"
      style={{
        display: "grid",
        gap: compact ? "14px" : expanded ? "22px" : "18px",
        padding: compact ? "16px" : expanded ? "30px" : "22px",
        borderRadius: compact ? "24px" : expanded ? "34px" : "28px",
        background: bg.shell,
        border: `1px solid ${bg.borderColor}`,
        boxShadow: "0 2px 8px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <div
        className="moodboard-stage"
        style={{
          position: "relative",
          minHeight: compact ? "320px" : expanded ? "720px" : "470px",
          borderRadius: compact ? "24px" : expanded ? "30px" : "24px",
          overflow: "hidden",
          background: bg.stage,
          border: `1px solid ${bg.borderColor}`,
          boxShadow: bg.isDark
            ? "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 4px rgba(0,0,0,0.18)"
            : "inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 4px rgba(0,0,0,0.04)",
        }}
      >
        {/* Palette-matched texture overlay */}
        {bg.textureOverlay !== "none" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "inherit",
              backgroundImage: bg.textureOverlay,
              pointerEvents: "none",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            top: compact ? "16px" : expanded ? "24px" : "20px",
            left: compact ? "16px" : expanded ? "24px" : "20px",
            right: compact ? "16px" : expanded ? "24px" : "20px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: compact ? "12px" : "18px",
            zIndex: 6,
            pointerEvents: "none",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3
              className="moodboard-title"
              style={{
                margin: 0,
                fontSize: compact ? "clamp(16px, 1.9vw, 20px)" : expanded ? "clamp(22px, 2.6vw, 28px)" : "clamp(18px, 2.2vw, 24px)",
                lineHeight: 1.25,
                letterSpacing: "0.01em",
                color: bg.titleColor,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                textDecorationLine: "underline",
                textDecorationThickness: "1px",
                textUnderlineOffset: "7px",
              }}
            >
              {title}
            </h3>
          </div>

          {palette.length > 0 && (
            <div style={{
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
              justifyContent: "flex-end",
              flexShrink: 0,
              padding: compact ? "5px 6px" : expanded ? "7px 8px" : "6px 7px",
              borderRadius: compact ? "10px" : "12px",
              background: "rgba(245, 240, 232, 0.15)",
              backdropFilter: "blur(6px)",
              border: "1px solid rgba(205, 191, 171, 0.42)",
              boxShadow: "0 2px 8px rgba(88, 65, 35, 0.08)",
            }}>
              {palette.map((swatch) => (
                <span
                  key={`${swatch.label}-${swatch.swatch}`}
                  title={swatch.label}
                  style={{
                    width: compact ? "14px" : expanded ? "20px" : "16px",
                    height: compact ? "14px" : expanded ? "20px" : "16px",
                    borderRadius: "999px",
                    background: swatch.swatch,
                    border: "2px solid rgba(255,255,255,0.82)",
                    boxShadow: "0 5px 12px rgba(88, 65, 35, 0.12)",
                  }}
                />
              ))}
            </div>
          )}
        </div>
        {stagePlacements.map((placement) => (
          <StageItem
            key={placement.item.id}
            placement={placement}
            expanded={expanded}
            compact={compact}
            imageMode={imageMode}
          />
        ))}
      </div>

    </div>
  );
}
