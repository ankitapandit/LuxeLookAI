/**
 * StyleDirectionMoodboard.tsx
 * ───────────────────────────
 * Visual 2×2 zone grid for a single "Beyond Your Wardrobe" style direction option.
 *
 * Zone layout (mirrors OutfitMoodboard stitch rules):
 *   Left top     → primary garment  (Top / Base / Bottom / Dress / Set / Swimwear)
 *   Left bottom  → Shoes / Footwear
 *   Right top    → Outerwear  (spans full right column when no accessories present)
 *   Right bottom → Bag / Accessories / Jewelry  (up to 2; spans full right when no outerwear)
 *
 * Each zone renders a Pexels image (when available) with a gradient overlay and
 * label + value text at the bottom.  When image_url is null the zone falls back
 * to a dark textured card so the grid always renders.
 *
 * Non-wearable pieces (Hair, Makeup, Sunscreen …) are NOT shown in the grid;
 * the parent page renders them as finishing notes below the moodboard.
 */

import type React from "react";
import { StyleDirectionOption, StyleDirectionPiece } from "@/services/api";

// ── Zone classification ────────────────────────────────────────────────────

const GARMENT_LABELS  = new Set(["top", "base", "bottom", "dress", "set", "swimwear"]);
const SHOE_LABELS     = new Set(["shoes", "footwear"]);
const OUTER_LABELS    = new Set(["outerwear"]);
const ACCESS_LABELS   = new Set(["bag", "accessories", "accessory", "jewelry"]);

type Zone = "garment" | "shoes" | "outerwear" | "accessory" | "finish";

/**
 * Classify a piece label into a moodboard zone.
 * Labels may be composite e.g. "Top/Base/Dress" — we check each slash-separated
 * part so any matching token wins.
 */
function zoneOf(label: string): Zone {
  const parts = label.toLowerCase().split(/[\s/]+/).filter(Boolean);
  for (const part of parts) {
    if (GARMENT_LABELS.has(part))  return "garment";
    if (SHOE_LABELS.has(part))     return "shoes";
    if (OUTER_LABELS.has(part))    return "outerwear";
    if (ACCESS_LABELS.has(part))   return "accessory";
  }
  return "finish";
}

// Strip generic filler so value text reads cleanly
function cleanValue(v: string): string {
  return v
    .replace(/\byour anchor (?:piece|item|swimwear|top|bottom|dress|set)?[^,.]*\b/gi, "")
    .replace(/\bas the hero\b/gi, "")
    .replace(/\bno cover-up needed\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── Layout constants ───────────────────────────────────────────────────────
// Mirrors OutfitMoodboard stitch percentages exactly.

const G  = 3;   // gap %
const LW = 44;  // left column width %
const RW = 44;  // right column width %
const RL = 53;  // right column left offset %

// ── Zone card ─────────────────────────────────────────────────────────────

interface ZoneCardProps {
  piece: StyleDirectionPiece;
  style: React.CSSProperties;
}

function ZoneCard({ piece, style }: ZoneCardProps) {
  const text = cleanValue(piece.value) || piece.value;
  const hasImage = Boolean(piece.image_url);

  return (
    <div
      style={{
        position: "absolute",
        overflow: "hidden",
        borderRadius: "10px",
        background: hasImage ? "#0E0C0A" : "rgba(28,24,18,0.90)",
        border: "1px solid rgba(212,169,106,0.13)",
        ...style,
      }}
    >
      {/* Pexels image */}
      {hasImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={piece.image_url!}
          alt={piece.label}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "top center",
          }}
        />
      )}

      {/* Dark texture overlay when no image */}
      {!hasImage && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "repeating-linear-gradient(135deg, rgba(255,255,255,0.014) 0px, rgba(255,255,255,0.014) 1px, transparent 1px, transparent 14px)",
          }}
        />
      )}

      {/* Gradient overlay — always present so text is legible over images */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: hasImage
            ? "linear-gradient(to bottom, transparent 30%, rgba(8,6,4,0.55) 58%, rgba(8,6,4,0.92) 100%)"
            : "linear-gradient(160deg, rgba(212,169,106,0.08) 0%, rgba(8,6,4,0.70) 100%)",
        }}
      />

      {/* Label + value */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "8px 9px 9px",
        }}
      >
        <p
          style={{
            margin: "0 0 2px",
            fontSize: "8.5px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.13em",
            color: "var(--gold, #D4A96A)",
            lineHeight: 1,
          }}
        >
          {piece.label}
        </p>
        <p
          style={{
            margin: 0,
            fontSize: "10px",
            lineHeight: 1.45,
            color: "rgba(255,247,237,0.88)",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {text}
        </p>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface StyleDirectionMoodboardProps {
  option: StyleDirectionOption;
}

export default function StyleDirectionMoodboard({ option }: StyleDirectionMoodboardProps) {
  // Sort pieces into zones
  const garment:   StyleDirectionPiece[] = [];
  const shoes:     StyleDirectionPiece[] = [];
  const outerwear: StyleDirectionPiece[] = [];
  const accessory: StyleDirectionPiece[] = [];

  for (const piece of option.pieces) {
    const z = zoneOf(piece.label);
    if (z === "garment")   garment.push(piece);
    else if (z === "shoes")     shoes.push(piece);
    else if (z === "outerwear") outerwear.push(piece);
    else if (z === "accessory") accessory.push(piece);
    // "finish" pieces (hair/makeup) are rendered by the parent, not here
  }

  const hasGarment   = garment.length > 0;
  const hasShoes     = shoes.length > 0;
  const hasOuterwear = outerwear.length > 0;
  const hasAccessory = accessory.length > 0;

  // Nothing to display — caller falls back to text chips
  if (!hasGarment && !hasShoes) return null;

  // ── Left column: garment zone split ─────────────────────────────────────
  // 1 garment  → single zone, top half of left column
  // 2 garments → stacked: first (hero/top) takes ~40%, second (bottom) ~24%
  const twoGarments   = garment.length >= 2;
  const garmentEndPct = hasShoes
    ? (twoGarments ? 67 : 67)   // same end whether 1 or 2; split internally
    : 96;

  // Heights within the garment zone for 1 vs 2 pieces
  const g1H = twoGarments ? 40 : garmentEndPct - G;  // hero piece height
  const g2Top = g1H + G;
  const g2H  = garmentEndPct - g2Top;                 // secondary piece height

  const leftShoesTop = garmentEndPct + G;
  const leftShoesH   = 96 - leftShoesTop;

  // ── Right column heights ─────────────────────────────────────────────────
  const rightOuterH    = hasOuterwear && hasAccessory ? 46 : 96;
  const rightAccessTop = hasOuterwear ? rightOuterH + G : G;
  const rightAccessH   = 96 - rightAccessTop;

  // Up to 2 accessories side-by-side
  const accessPairs = accessory.slice(0, 2);
  const accessW     = accessPairs.length === 2 ? (RW - G) / 2 : RW;

  // When nothing in the right column, extend left column to full width
  const leftW = hasOuterwear || hasAccessory ? LW : 94;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        paddingBottom: "108%",
        borderRadius: "14px",
        overflow: "hidden",
        background: "#0A0806",
      }}
    >
      {/* ── Left: garment hero (top / base / dress) ── */}
      {hasGarment && (
        <ZoneCard
          piece={garment[0]}
          style={{
            left:   `${G}%`,
            top:    `${G}%`,
            width:  `${leftW}%`,
            height: `${g1H}%`,
          }}
        />
      )}

      {/* ── Left: garment secondary (bottom) — only when 2 garments present ── */}
      {twoGarments && (
        <ZoneCard
          piece={garment[1]}
          style={{
            left:   `${G}%`,
            top:    `${g2Top}%`,
            width:  `${leftW}%`,
            height: `${g2H}%`,
          }}
        />
      )}

      {/* ── Left: shoes ── */}
      {hasShoes && (
        <ZoneCard
          piece={shoes[0]}
          style={{
            left:   `${G}%`,
            top:    `${leftShoesTop}%`,
            width:  `${leftW}%`,
            height: `${leftShoesH}%`,
          }}
        />
      )}

      {/* ── Right: outerwear ── */}
      {hasOuterwear && (
        <ZoneCard
          piece={outerwear[0]}
          style={{
            left:   `${RL}%`,
            top:    `${G}%`,
            width:  `${RW}%`,
            height: `${rightOuterH}%`,
          }}
        />
      )}

      {/* ── Right: accessories (up to 2) ── */}
      {accessPairs.map((piece, i) => (
        <ZoneCard
          key={piece.label}
          piece={piece}
          style={{
            left:   `${RL + i * (accessW + G)}%`,
            top:    `${rightAccessTop}%`,
            width:  `${accessW}%`,
            height: `${rightAccessH}%`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Returns the non-wearable finishing pieces (Hair, Makeup, Sunscreen…)
 * so the parent can render them as text below the moodboard grid.
 */
export function getFinishPieces(pieces: StyleDirectionPiece[]): StyleDirectionPiece[] {
  return pieces.filter(
    (p) => !GARMENT_LABELS.has(p.label.toLowerCase()) &&
           !SHOE_LABELS.has(p.label.toLowerCase()) &&
           !OUTER_LABELS.has(p.label.toLowerCase()) &&
           !ACCESS_LABELS.has(p.label.toLowerCase()),
  );
}
