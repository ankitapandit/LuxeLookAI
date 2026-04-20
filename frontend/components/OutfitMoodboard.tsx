import { useState } from "react";
import Image from "next/image";
import { ClothingItem, OutfitCard } from "@/services/api";
import { getDisplayColorName, getItemDisplayName } from "@/utils/itemDisplay";

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

function getStitchPlacements(items: ClothingItem[]): StagePlacement[] {
  const fullLook  = items.find((i) => ["dresses", "set", "swimwear", "loungewear"].includes(i.category));
  const top       = items.find((i) => i.category === "tops");
  const bottom    = items.find((i) => i.category === "bottoms");
  const outerwear = items.find((i) => i.category === "outerwear");
  const shoes     = items.find((i) => i.category === "shoes");
  const accList   = items.filter((i) => ["accessories", "jewelry"].includes(i.category));

  const placements: StagePlacement[] = [];

  // Shared measurements (all in %)
  // Left column:  left=3,  width=44  → right edge 47%
  // Right column: left=53, width=44  → right edge 97%
  const G  = 3;   // gutter
  const LW = 44;  // left column width  (50 - 2*G)
  const RW = 44;  // right column width (50 - 2*G)
  const RL = 53;  // right column left  (50 + G)

  // ── Left column: main garment + shoes ──────────────────────────────────────
  if (fullLook) {
    // Single full-length garment → tall, shoes fill the bottom strip
    placements.push({ item: fullLook, left: `${G}%`, top: `${G}%`, width: `${LW}%`, height: "67%", zIndex: 3 });
    if (shoes) {
      placements.push({ item: shoes, left: `${G}%`, top: "73%", width: `${LW}%`, height: "23%", zIndex: 4 });
    }
  } else if (top && bottom) {
    // Stack top above bottom; shoes as a thin strip at the very bottom
    placements.push({ item: top,    left: `${G}%`, top: `${G}%`, width: `${LW}%`, height: "40%", zIndex: 4 });
    placements.push({ item: bottom, left: `${G}%`, top: "44%",   width: `${LW}%`, height: "40%", zIndex: 3 });
    if (shoes) {
      placements.push({ item: shoes, left: `${G}%`, top: "85%", width: `${LW}%`, height: "12%", zIndex: 5 });
    }
  } else {
    // Single top or single bottom
    const single = top ?? bottom;
    if (single) {
      placements.push({ item: single, left: `${G}%`, top: `${G}%`, width: `${LW}%`, height: "67%", zIndex: 3 });
    }
    if (shoes) {
      placements.push({ item: shoes, left: `${G}%`, top: "73%", width: `${LW}%`, height: "23%", zIndex: 4 });
    }
  }

  // ── Right column: outerwear (top) + accessories (bottom) ───────────────────
  const usedIds = new Set(placements.map((p) => p.item.id));
  const accToShow = accList.filter((i) => !usedIds.has(i.id));

  if (outerwear && accToShow.length > 0) {
    // Both zones occupied — split right column 50 / 50
    placements.push({ item: outerwear, left: `${RL}%`, top: `${G}%`, width: `${RW}%`, height: "46%", zIndex: 3 });

    if (accToShow.length === 1) {
      placements.push({ item: accToShow[0], left: `${RL}%`, top: "52%", width: `${RW}%`, height: "44%", zIndex: 3 });
    } else {
      // Two accessories side-by-side in the bottom-right zone
      const halfW = 21;
      const halfGap = 2;
      placements.push({ item: accToShow[0], left: `${RL}%`,             top: "52%", width: `${halfW}%`, height: "44%", zIndex: 3 });
      placements.push({ item: accToShow[1], left: `${RL + halfW + halfGap}%`, top: "52%", width: `${halfW}%`, height: "44%", zIndex: 3 });
    }
  } else if (outerwear) {
    // No accessories — outerwear fills the full right column
    placements.push({ item: outerwear, left: `${RL}%`, top: `${G}%`, width: `${RW}%`, height: `${94 - G * 2}%`, zIndex: 3 });
  } else if (accToShow.length > 0) {
    // No outerwear — accessories fill the full right column (stacked vertically)
    if (accToShow.length === 1) {
      placements.push({ item: accToShow[0], left: `${RL}%`, top: `${G}%`, width: `${RW}%`, height: `${94 - G * 2}%`, zIndex: 3 });
    } else {
      placements.push({ item: accToShow[0], left: `${RL}%`, top: `${G}%`, width: `${RW}%`, height: "46%", zIndex: 3 });
      placements.push({ item: accToShow[1], left: `${RL}%`, top: "52%",   width: `${RW}%`, height: "44%", zIndex: 3 });
    }
  }

  return placements;
}

function getStagePlacements(items: ClothingItem[], compact: boolean = false): StagePlacement[] {
  const fullLook = items.find((item) => ["dresses", "set", "swimwear", "loungewear"].includes(item.category));
  const top = items.find((item) => item.category === "tops");
  const bottom = items.find((item) => item.category === "bottoms");
  const outerwear = items.find((item) => item.category === "outerwear");
  const shoes = items.find((item) => item.category === "shoes");
  const accessories = items.filter((item) => ["accessories", "jewelry"].includes(item.category));

  const placements: StagePlacement[] = [];

  // When there is no full-length garment, no top, and no bottom (e.g. outerwear-
  // only look), promote outerwear to the hero slot so items don't cluster on the
  // right with the entire left half empty.
  const outerwearIsHero = !fullLook && !top && !bottom && !!outerwear;

  if (fullLook || outerwearIsHero) {
    const hero = fullLook ?? outerwear!;

    if (outerwear && !outerwearIsHero) {
      // fullLook + outerwear: lay them side-by-side with only slight overlap so
      // both garments are clearly readable — set on the left, jacket on the right.
      placements.push({
        item: hero,
        left: compact ? "5%" : "4%",
        top: compact ? "6%" : "5%",
        width: compact ? "44%" : "48%",
        height: compact ? "76%" : "82%",
        rotation: getRotation(hero.id, compact ? -3 : -2),
        zIndex: 3,
      });
      placements.push({
        item: outerwear,
        left: compact ? "42%" : "40%",
        top: compact ? "4%" : "3%",
        width: compact ? "40%" : "44%",
        height: compact ? "54%" : "60%",
        rotation: getRotation(outerwear.id, compact ? 5 : 3),
        zIndex: 5,
      });
      if (shoes) placements.push({
        item: shoes,
        left: compact ? "64%" : "62%",
        top: compact ? "66%" : "64%",
        width: compact ? "20%" : "24%",
        height: compact ? "16%" : "20%",
        rotation: getRotation(shoes.id, compact ? -5 : -3),
        zIndex: 4,
      });
    } else {
      // fullLook only (no outerwear) or outerwear-as-hero: hero fills the left column.
      placements.push({
        item: hero,
        left: compact ? "11%" : "8%",
        top: compact ? "7%" : "6%",
        width: compact ? "48%" : "54%",
        height: compact ? "78%" : "84%",
        rotation: getRotation(hero.id, compact ? -4 : -2),
        zIndex: 4,
      });
      if (shoes) placements.push({
        item: shoes,
        left: compact ? "67%" : "66%",
        top: compact ? "64%" : "62%",
        width: compact ? "19%" : "22%",
        height: compact ? "15%" : "18%",
        rotation: getRotation(shoes.id, compact ? -6 : -4),
        zIndex: 4,
      });
    }
  } else {
    if (top) placements.push({
      item: top,
      left: compact ? "9%" : "7%",
      top: compact ? "7%" : "5%",
      width: compact ? "34%" : "38%",
      height: compact ? "32%" : "38%",
      rotation: getRotation(top.id, compact ? -5 : -3),
      zIndex: 5,
    });
    if (bottom) placements.push({
      item: bottom,
      left: compact ? "21%" : "18%",
      top: compact ? "31%" : "28%",
      width: compact ? "40%" : "44%",
      height: compact ? "54%" : "60%",
      rotation: getRotation(bottom.id, compact ? 4 : 2),
      zIndex: 3,
    });
    if (outerwear) placements.push({
      item: outerwear,
      left: compact ? "45%" : "42%",
      top: compact ? "9%" : "7%",
      width: compact ? "28%" : "34%",
      height: compact ? "32%" : "38%",
      rotation: getRotation(outerwear.id, compact ? 6 : 4),
      zIndex: 6,
    });
    if (shoes) placements.push({
      item: shoes,
      left: compact ? "67%" : "66%",
      top: compact ? "65%" : "61%",
      width: compact ? "19%" : "22%",
      height: compact ? "15%" : "18%",
      rotation: getRotation(shoes.id, compact ? -6 : -3),
      zIndex: 4,
    });
  }

  // Accessory slots — when outerwear is the hero, pull accessories inward so
  // they don't cluster in the far-right void next to an empty column.
  accessories.slice(0, 3).forEach((item, index) => {
    const accessorySlots = outerwearIsHero
      ? [
          // Closer to the stage centre so nothing feels isolated
          { left: "66%", top: "6%",  width: "20%", height: "16%", rotation: getRotation(item.id, 5)  },
          { left: "68%", top: "30%", width: "18%", height: "16%", rotation: getRotation(item.id, -4) },
          { left: "65%", top: "56%", width: "18%", height: "14%", rotation: getRotation(item.id, 4)  },
        ]
      : [
          { left: "69%", top: "8%",  width: "18%", height: "15%", rotation: getRotation(item.id, 5)  },
          { left: "74%", top: "28%", width: "15%", height: "15%", rotation: getRotation(item.id, -5) },
          { left: "70%", top: "78%", width: "16%", height: "11%", rotation: getRotation(item.id, 4)  },
        ];
    const slot = accessorySlots[index];
    if (slot) {
      placements.push({ item, ...slot, zIndex: 5 - index });
    }
  });

  const used = new Set(placements.map((entry) => entry.item.id));
  const leftovers = items.filter((item) => !used.has(item.id)).slice(0, 1);
  leftovers.forEach((item, index) => {
    const fallback = [
      { left: "56%", top: "18%", width: "22%", height: "22%", rotation: getRotation(item.id, -3) },
      { left: "60%", top: "46%", width: "20%", height: "20%", rotation: getRotation(item.id, 3) },
      { left: "10%", top: "74%", width: "18%", height: "14%", rotation: getRotation(item.id, -4) },
    ][index];
    if (fallback) placements.push({ item, ...fallback, zIndex: 2 });
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
        transform: placement.rotation ? `rotate(${placement.rotation})` : undefined,
        transformOrigin: "center center",
        zIndex: placement.zIndex ?? 1,
        // Flat-lay: diffuse downward shadow as if lit from directly above
        filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.11)) drop-shadow(0 2px 5px rgba(0,0,0,0.07))",
      }}
      title={getItemHoverLabel(placement.item)}
    >
      <Image
        src={imageSrc}
        alt={getItemDisplayName(placement.item)}
        fill
        unoptimized={shouldBypassImageOptimization(imageSrc)}
        sizes={expanded ? "(max-width: 900px) 55vw, 620px" : compact ? "(max-width: 900px) 44vw, 380px" : "(max-width: 900px) 48vw, 420px"}
        style={{ objectFit: "contain" }}
      />
      {hovered && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: compact ? "-18px" : expanded ? "-24px" : "-20px",
            transform: "translateX(-50%)",
            padding: compact ? "5px 8px" : expanded ? "7px 12px" : "6px 10px",
            borderRadius: "999px",
            background: "rgba(24, 23, 20, 0.88)",
            color: "#F4EEE4",
            fontSize: compact ? "10px" : expanded ? "12px" : "11px",
            fontWeight: 500,
            whiteSpace: "nowrap",
            letterSpacing: "0.01em",
            boxShadow: "0 8px 18px rgba(0,0,0,0.18)",
            pointerEvents: "none",
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

  const subhead = card?.vibe || card?.color_theory || "A softer, editorial moodboard built from your own wardrobe.";

  // ── Stitch variant ────────────────────────────────────────────────────────
  if (variant === "stitch") {
    const stitchPlacements = getStitchPlacements(items);

    return (
      <div
        className="moodboard-shell moodboard-stitch"
        style={{
          display: "flex",
          flexDirection: "column",
          borderRadius: compact ? "20px" : expanded ? "28px" : "24px",
          overflow: "hidden",
          background: "#FFFFFF",
          border: "1px solid rgba(0,0,0,0.08)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05)",
        }}
      >
        {/* ── Image stage ── */}
        <div
          className="moodboard-stage"
          style={{
            position: "relative",
            // Aspect ratio approximates the sample images (portrait card)
            aspectRatio: compact ? "3 / 4" : expanded ? "4 / 5" : "3 / 4",
            background: "#F8F6F2",
            overflow: "hidden",
          }}
        >
          {/* Very subtle warm paper tone */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: "radial-gradient(ellipse at 50% 0%, rgba(230,220,205,0.20) 0%, transparent 65%)",
              pointerEvents: "none",
              zIndex: 1,
            }}
          />

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

        {/* ── Bottom label bar ── */}
        <div
          className="moodboard-label"
          style={{
            padding: compact ? "14px 16px 15px" : expanded ? "18px 24px 20px" : "15px 20px 16px",
            borderTop: "1px solid rgba(0,0,0,0.07)",
            background: "#FFFFFF",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <div style={{ minWidth: 0 }}>
            {/* Title */}
            <h3
              style={{
                margin: 0,
                fontFamily: "Playfair Display, serif",
                fontSize: compact ? "clamp(18px, 2.5vw, 22px)" : expanded ? "clamp(24px, 3vw, 34px)" : "clamp(20px, 2.8vw, 26px)",
                lineHeight: 1.05,
                letterSpacing: "-0.03em",
                color: "#1A1410",
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {title}
            </h3>

            {/* Subhead — vibe or color theory */}
            <p
              style={{
                margin: "5px 0 0",
                fontSize: compact ? "11px" : "12px",
                color: "#7A6A55",
                lineHeight: 1.45,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 1,
                WebkitBoxOrient: "vertical",
              }}
            >
              {subhead}
            </p>
          </div>

          {/* Color swatches — stacked vertically on the right */}
          {palette.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", flexShrink: 0, alignSelf: "flex-start", marginTop: compact ? "2px" : "4px" }}>
              {palette.slice(0, 4).map((swatch) => (
                <span
                  key={`${swatch.label}-${swatch.swatch}`}
                  title={swatch.label}
                  style={{
                    width: compact ? "14px" : "16px",
                    height: compact ? "14px" : "16px",
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
      </div>
    );
  }

  // ── Editorial variant (original, unchanged) ───────────────────────────────
  const stagePlacements = getStagePlacements(items, compact);

  return (
    <div
      className="moodboard-shell"
      style={{
        display: "grid",
        gap: compact ? "14px" : expanded ? "22px" : "18px",
        padding: compact ? "16px" : expanded ? "30px" : "22px",
        borderRadius: compact ? "24px" : expanded ? "34px" : "28px",
        // Editorial flat-lay: clean warm off-white paper surface
        background: "#F7F3EE",
        border: "1px solid rgba(0,0,0,0.07)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <div
        className="moodboard-header"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: compact ? "12px" : "18px",
          alignItems: "start",
          minHeight: compact ? "128px" : undefined,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h3
            style={{
              margin: 0,
              fontFamily: "Playfair Display, serif",
              fontSize: compact ? "clamp(24px, 3vw, 30px)" : expanded ? "clamp(36px, 4vw, 52px)" : "clamp(28px, 3vw, 40px)",
              lineHeight: 0.94,
              letterSpacing: "-0.04em",
              color: "#241B10",
              maxWidth: compact ? "11ch" : expanded ? "14ch" : "12ch",
              minHeight: compact ? "56px" : undefined,
              display: "-webkit-box",
              WebkitLineClamp: compact ? 2 : undefined,
              WebkitBoxOrient: compact ? "vertical" : undefined,
              overflow: compact ? "hidden" : undefined,
            }}
          >
            {title}
          </h3>

          <p
            style={{
              margin: compact ? "8px 0 0" : "12px 0 0",
              color: "#705B43",
              fontSize: compact ? "12px" : expanded ? "15px" : "13px",
              lineHeight: 1.6,
              maxWidth: compact ? "26rem" : expanded ? "38rem" : "30rem",
              minHeight: compact ? "20px" : undefined,
              // Clamp to consistent line count so header height is uniform across cards
              display: "-webkit-box",
              WebkitLineClamp: compact ? 1 : expanded ? 3 : 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {subhead}
          </p>
        </div>

        {palette.length > 0 ? (
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end", alignSelf: "flex-start", marginTop: compact ? "2px" : "4px" }}>
            {palette.map((swatch) => (
              <span
                key={`${swatch.label}-${swatch.swatch}`}
                title={swatch.label}
              style={{
                  width: compact ? "16px" : expanded ? "24px" : "20px",
                  height: compact ? "16px" : expanded ? "24px" : "20px",
                  borderRadius: "999px",
                  background: swatch.swatch,
                  border: "2px solid rgba(255,255,255,0.82)",
                  boxShadow: "0 5px 12px rgba(88, 65, 35, 0.12)",
                }}
              />
            ))}
          </div>
        ) : <div />}
      </div>

      <div
        className="moodboard-stage"
        style={{
          position: "relative",
          minHeight: compact ? "320px" : expanded ? "720px" : "470px",
          borderRadius: compact ? "24px" : expanded ? "30px" : "24px",
          overflow: "hidden",
          // Clean white paper surface for flat-lay feel
          background: "#FFFFFF",
          border: "1px solid rgba(0,0,0,0.06)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 4px rgba(0,0,0,0.04)",
        }}
      >
        {/* Subtle paper warmth — non-intrusive texture hints */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "inherit",
            backgroundImage: [
              "radial-gradient(ellipse at 18% 18%, rgba(235,225,210,0.16) 0%, transparent 52%)",
              "radial-gradient(ellipse at 82% 82%, rgba(220,210,195,0.10) 0%, transparent 48%)",
            ].join(", "),
            pointerEvents: "none",
          }}
        />
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
