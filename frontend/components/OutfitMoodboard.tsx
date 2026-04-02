import { useState } from "react";
import Image from "next/image";
import { ClothingItem, OutfitCard } from "@/services/api";

function shouldBypassImageOptimization(src: string): boolean {
  return src.startsWith("blob:") || src.startsWith("data:");
}

function firstSentence(text?: string | null): string {
  if (!text) return "";
  const clean = text.replace(/[“”„‟"]/g, "").replace(/\s+/g, " ").trim();
  const split = clean.search(/(?<=[.!?])\s+/);
  return split > -1 ? clean.slice(0, split).trim() : clean;
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
    set: "Set",
    swimwear: "Swim",
    loungewear: "Lounge",
  };

  return labels[category] || titleCase(category);
}

function getDisplayName(item: ClothingItem): string {
  if (item.category === "accessories" && item.accessory_subtype) {
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

function getImageSrc(item: ClothingItem): string {
  return item.cutout_url || item.thumbnail_url || item.image_url;
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
  const offset = (hashString(itemId) % 7) - 3;
  return `${base + offset}deg`;
}

function getStagePlacements(items: ClothingItem[]): StagePlacement[] {
  const fullLook = items.find((item) => ["dresses", "set", "swimwear", "loungewear"].includes(item.category));
  const top = items.find((item) => item.category === "tops");
  const bottom = items.find((item) => item.category === "bottoms");
  const outerwear = items.find((item) => item.category === "outerwear");
  const shoes = items.find((item) => item.category === "shoes");
  const accessories = items.filter((item) => item.category === "accessories");

  const placements: StagePlacement[] = [];

  if (fullLook) {
    placements.push({ item: fullLook, left: "8%", top: "6%", width: "54%", height: "84%", rotation: getRotation(fullLook.id, -4), zIndex: 4 });
    if (outerwear) placements.push({ item: outerwear, left: "45%", top: "10%", width: "30%", height: "40%", rotation: getRotation(outerwear.id, 8), zIndex: 5 });
    if (shoes) placements.push({ item: shoes, left: "66%", top: "62%", width: "22%", height: "18%", rotation: getRotation(shoes.id, -7), zIndex: 4 });
  } else {
    if (top) placements.push({ item: top, left: "7%", top: "5%", width: "38%", height: "38%", rotation: getRotation(top.id, -8), zIndex: 5 });
    if (bottom) placements.push({ item: bottom, left: "18%", top: "28%", width: "44%", height: "60%", rotation: getRotation(bottom.id, 5), zIndex: 3 });
    if (outerwear) placements.push({ item: outerwear, left: "42%", top: "7%", width: "34%", height: "38%", rotation: getRotation(outerwear.id, 10), zIndex: 6 });
    if (shoes) placements.push({ item: shoes, left: "66%", top: "61%", width: "22%", height: "18%", rotation: getRotation(shoes.id, -8), zIndex: 4 });
  }

  accessories.slice(0, 3).forEach((item, index) => {
    const accessorySlots = [
      { left: "69%", top: "8%", width: "18%", height: "15%", rotation: getRotation(item.id, 9) },
      { left: "74%", top: "28%", width: "15%", height: "15%", rotation: getRotation(item.id, -10) },
      { left: "70%", top: "78%", width: "16%", height: "11%", rotation: getRotation(item.id, 7) },
    ];
    const slot = accessorySlots[index];
    if (slot) {
      placements.push({ item, ...slot, zIndex: 5 - index });
    }
  });

  const used = new Set(placements.map((entry) => entry.item.id));
  const leftovers = items.filter((item) => !used.has(item.id));
  leftovers.forEach((item, index) => {
    const fallback = [
      { left: "56%", top: "18%", width: "22%", height: "22%", rotation: getRotation(item.id, -6) },
      { left: "60%", top: "46%", width: "20%", height: "20%", rotation: getRotation(item.id, 6) },
      { left: "10%", top: "74%", width: "18%", height: "14%", rotation: getRotation(item.id, -7) },
    ][index];
    if (fallback) placements.push({ item, ...fallback, zIndex: 2 });
  });

  return placements;
}

function StageItem({ placement, expanded }: { placement: StagePlacement; expanded: boolean }) {
  const imageSrc = getImageSrc(placement.item);
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
        filter: expanded
          ? "drop-shadow(0 18px 30px rgba(104, 78, 43, 0.22))"
          : "drop-shadow(0 12px 20px rgba(104, 78, 43, 0.19))",
      }}
      title={getItemHoverLabel(placement.item)}
    >
      <Image
        src={imageSrc}
        alt={getDisplayName(placement.item)}
        fill
        unoptimized={shouldBypassImageOptimization(imageSrc)}
        sizes={expanded ? "(max-width: 900px) 55vw, 620px" : "(max-width: 900px) 48vw, 420px"}
        style={{ objectFit: "contain" }}
      />
      {hovered && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: expanded ? "-24px" : "-20px",
            transform: "translateX(-50%)",
            padding: expanded ? "7px 12px" : "6px 10px",
            borderRadius: "999px",
            background: "rgba(24, 23, 20, 0.88)",
            color: "#F4EEE4",
            fontSize: expanded ? "12px" : "11px",
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
}: {
  items: ClothingItem[];
  card?: OutfitCard;
  title: string;
  eyebrow: string;
  scoreLabel?: string;
  expanded?: boolean;
}) {
  const palette = items
    .map((item) => parseColorSwatch(item.color))
    .filter((entry): entry is { label: string; swatch: string } => Boolean(entry))
    .filter((entry, index, arr) => arr.findIndex((current) => current.swatch === entry.swatch) === index)
    .slice(0, expanded ? 6 : 4);
  const stagePlacements = getStagePlacements(items);
  const note = firstSentence(card?.verdict) || card?.fit_check || "Pulled into a polished, wearable edit.";
  const subhead = card?.vibe || card?.color_theory || "A softer, editorial moodboard built from your own wardrobe.";

  return (
    <div
      className="moodboard-shell"
      style={{
        display: "grid",
        gap: expanded ? "22px" : "18px",
        padding: expanded ? "30px" : "22px",
        borderRadius: expanded ? "34px" : "28px",
        background: "linear-gradient(145deg, #FBF5EC 0%, #F4E8D8 62%, #E8D4B9 100%)",
        border: "1px solid rgba(148, 117, 78, 0.18)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.72), 0 22px 50px rgba(72, 53, 27, 0.10)",
      }}
    >
      <div
        className="moodboard-header"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: "18px",
          alignItems: "start",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
            <span
              style={{
                fontSize: expanded ? "11px" : "10px",
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
                  padding: expanded ? "6px 12px" : "5px 11px",
                  borderRadius: "999px",
                  background: "rgba(114, 86, 44, 0.08)",
                  color: "#695535",
                  fontSize: expanded ? "12px" : "11px",
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
              fontSize: expanded ? "clamp(36px, 4vw, 52px)" : "clamp(28px, 3vw, 40px)",
              lineHeight: 0.94,
              letterSpacing: "-0.04em",
              color: "#241B10",
              maxWidth: expanded ? "14ch" : "12ch",
            }}
          >
            {title}
          </h3>

          <p
            style={{
              margin: "12px 0 0",
              color: "#705B43",
              fontSize: expanded ? "15px" : "13px",
              lineHeight: 1.6,
              maxWidth: expanded ? "38rem" : "30rem",
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
                  width: expanded ? "24px" : "20px",
                  height: expanded ? "24px" : "20px",
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
          minHeight: expanded ? "720px" : "470px",
          borderRadius: expanded ? "30px" : "24px",
          overflow: "hidden",
          background: "radial-gradient(circle at top left, rgba(255,255,255,0.88), rgba(255,255,255,0) 42%), linear-gradient(180deg, rgba(255,251,246,0.72) 0%, rgba(245,232,216,0.46) 100%)",
          border: "1px solid rgba(145, 116, 78, 0.12)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "5%",
            right: "5%",
            top: "7%",
            bottom: "7%",
            borderRadius: expanded ? "24px" : "20px",
            border: "1px dashed rgba(157, 129, 93, 0.20)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "52%",
            top: "5%",
            width: expanded ? "160px" : "120px",
            height: expanded ? "160px" : "120px",
            background: "radial-gradient(circle, rgba(232, 197, 151, 0.28) 0%, rgba(232, 197, 151, 0) 68%)",
            filter: "blur(3px)",
          }}
        />
        {stagePlacements.map((placement) => (
          <StageItem
            key={placement.item.id}
            placement={placement}
            expanded={expanded}
          />
        ))}
      </div>

      <div className="moodboard-footer">
        <div
          style={{
            borderRadius: expanded ? "22px" : "18px",
            padding: expanded ? "18px" : "14px",
            background: "rgba(255,255,255,0.48)",
            border: "1px solid rgba(138, 110, 74, 0.14)",
            maxWidth: expanded ? "340px" : "280px",
          }}
        >
          <div
            style={{
              color: "#896A45",
              fontSize: expanded ? "11px" : "10px",
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              marginBottom: "10px",
            }}
          >
            Stylist note
          </div>
          <p
            style={{
              margin: 0,
              color: "#4A3724",
              fontSize: expanded ? "18px" : "14px",
              lineHeight: 1.5,
              fontStyle: "italic",
            }}
          >
            {note}
          </p>
        </div>
      </div>
    </div>
  );
}
