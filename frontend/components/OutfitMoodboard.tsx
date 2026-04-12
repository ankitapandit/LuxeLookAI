import { useState } from "react";
import Image from "next/image";
import { ClothingItem, OutfitCard } from "@/services/api";

function shouldBypassImageOptimization(src: string): boolean {
  return src.startsWith("blob:") || src.startsWith("data:");
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getDisplayColor(color?: string): string {
  if (!color) return "";
  if (color.startsWith("#")) return color.toUpperCase();

  const overrides: Record<string, string> = {
    black: "Black",
    white: "White",
    navy: "Navy",
    beige: "Beige",
    red: "Red",
    green: "Green",
    grey: "Grey",
    gray: "Grey",
    brown: "Brown",
    pink: "Pink",
    blue: "Blue",
    yellow: "Yellow",
    orange: "Orange",
    purple: "Purple",
    cream: "Cream",
    tan: "Tan",
    gold: "Gold",
    silver: "Silver",
  };

  const normalized = color.toLowerCase().trim();
  if (overrides[normalized]) return overrides[normalized];
  return titleCase(color);
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
  };

  const normalized = color.toLowerCase().trim();
  if (preset[normalized]) return { label: color, swatch: preset[normalized] };
  const matched = Object.keys(preset).find((key) => normalized.includes(key));
  return matched ? { label: color, swatch: preset[matched] } : null;
}

function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    tops: "Top",
    bottoms: "Bottom",
    dresses: "Dress",
    outerwear: "Layer",
    shoes: "Shoes",
    accessories: "Accessory",
    jewelry: "Jewelry",
    set: "Set",
    swimwear: "Swim",
    loungewear: "Lounge",
  };

  return labels[category] || titleCase(category);
}

function getDisplayName(item: ClothingItem): string {
  if ((item.category === "accessories" || item.category === "jewelry") && item.accessory_subtype) {
    return titleCase(item.accessory_subtype);
  }
  if (item.item_type && !["core_garment", "footwear", "outerwear", "accessory"].includes(item.item_type)) {
    return titleCase(item.item_type);
  }
  return categoryLabel(item.category);
}

function getItemHoverLabel(item: ClothingItem): string {
  const color = getDisplayColor(item.color);
  return color ? `${getDisplayName(item)} · ${color}` : getDisplayName(item);
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

function getStagePlacements(items: ClothingItem[], compact: boolean = false): StagePlacement[] {
  const fullLook = items.find((item) => ["dresses", "set", "swimwear", "loungewear"].includes(item.category));
  const top = items.find((item) => item.category === "tops");
  const bottom = items.find((item) => item.category === "bottoms");
  const outerwear = items.find((item) => item.category === "outerwear");
  const shoes = items.find((item) => item.category === "shoes");
  const accessories = items.filter((item) => ["accessories", "jewelry"].includes(item.category));

  const placements: StagePlacement[] = [];

  if (fullLook) {
    placements.push({
      item: fullLook,
      left: compact ? "11%" : "8%",
      top: compact ? "7%" : "6%",
      width: compact ? "48%" : "54%",
      height: compact ? "78%" : "84%",
      rotation: getRotation(fullLook.id, compact ? -4 : -2),
      zIndex: 4,
    });
    if (outerwear) placements.push({
      item: outerwear,
      left: compact ? "47%" : "45%",
      top: compact ? "11%" : "10%",
      width: compact ? "27%" : "30%",
      height: compact ? "34%" : "40%",
      rotation: getRotation(outerwear.id, compact ? 6 : 4),
      zIndex: 5,
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

  accessories.slice(0, 3).forEach((item, index) => {
    const accessorySlots = [
      { left: "69%", top: "8%", width: "18%", height: "15%", rotation: getRotation(item.id, 5) },
      { left: "74%", top: "28%", width: "15%", height: "15%", rotation: getRotation(item.id, -5) },
      { left: "70%", top: "78%", width: "16%", height: "11%", rotation: getRotation(item.id, 4) },
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
        alt={getDisplayName(placement.item)}
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
  eyebrow,
  scoreLabel,
  expanded = false,
  compact = false,
  imageMode = "cutout",
}: {
  items: ClothingItem[];
  card?: OutfitCard;
  title: string;
  eyebrow: string;
  scoreLabel?: string;
  expanded?: boolean;
  compact?: boolean;
  imageMode?: "cutout" | "upload";
}) {
  const palette = items
    .map((item) => parseColorSwatch(item.color))
    .filter((entry): entry is { label: string; swatch: string } => Boolean(entry))
    .filter((entry, index, arr) => arr.findIndex((current) => current.swatch === entry.swatch) === index)
    .slice(0, expanded ? 6 : 4);
  const stagePlacements = getStagePlacements(items, compact);
  const subhead = card?.vibe || card?.color_theory || "A softer, editorial moodboard built from your own wardrobe.";

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
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: compact ? "8px" : "12px" }}>
            <span
              style={{
                fontSize: compact ? "10px" : expanded ? "11px" : "10px",
                fontWeight: 700,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "#7A6A55",
              }}
            >
              {eyebrow}
            </span>
            {scoreLabel ? (
              <span
              style={{
                  padding: compact ? "4px 10px" : expanded ? "6px 12px" : "5px 11px",
                  borderRadius: "999px",
                  background: "rgba(114, 86, 44, 0.08)",
                  color: "#695535",
                  fontSize: compact ? "10px" : expanded ? "12px" : "11px",
                  fontWeight: 600,
                }}
              >
                {scoreLabel}
              </span>
            ) : null}
          </div>

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
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
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
