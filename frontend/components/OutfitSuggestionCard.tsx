import { useState } from "react";
import OutfitMetricCard, { isCurrentCardSchema } from "@/components/OutfitCard";
import OutfitMoodboard from "@/components/OutfitMoodboard";
import { ClothingItem, OutfitSuggestion } from "@/services/api";

function getOutfitTitle(suggestion: OutfitSuggestion, wardrobeMap: Record<string, ClothingItem>): string {
  if (isCurrentCardSchema(suggestion.card) && suggestion.card.look_title) {
    return suggestion.card.look_title;
  }

  if (isCurrentCardSchema(suggestion.card) && suggestion.card.vibe) {
    return suggestion.card.vibe
      .replace(/\+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  const items = suggestion.item_ids.map((id) => wardrobeMap[id]).filter(Boolean);
  if (!items.length) return "Curated look";
  const colors = Array.from(new Set(items.map((item) => item.color).filter(Boolean)));
  const color = colors.slice(0, 2).join(" & ");
  return color ? `${color} edit` : "Curated look";
}

export default function OutfitSuggestionCard({
  suggestion,
  wardrobeMap,
  onRate,
  compact = false,
  showMetricsWhenCompact = false,
  imageMode = "cutout",
  moodboardVariant = "editorial",
}: {
  suggestion: OutfitSuggestion;
  wardrobeMap: Record<string, ClothingItem>;
  onRate: (rating: number) => void;
  compact?: boolean;
  showMetricsWhenCompact?: boolean;
  imageMode?: "cutout" | "upload";
  /** Controls the moodboard layout style passed down to OutfitMoodboard.
   *  "editorial" — original scatter with header above (default).
   *  "stitch"    — clean 2×2 grid with title label below the image. */
  moodboardVariant?: "editorial" | "stitch";
}) {
  const [hover, setHover] = useState(0);

  const items = [...suggestion.item_ids, ...(suggestion.accessory_ids || [])]
    .map((id) => wardrobeMap[id])
    .filter(Boolean);
  const title = getOutfitTitle(suggestion, wardrobeMap);
  const currentRating = suggestion.user_rating ?? 0;
  const hasRating = suggestion.user_rating !== null && suggestion.user_rating !== undefined;

  return (
    <>
      <div
        className="card fade-up"
        style={{
          padding: compact ? "16px" : "24px",
          minHeight: compact ? "0" : "300px",
          height: "100%",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Grows to absorb any extra height, keeping rating row pinned to bottom */}
        <div style={{ flex: 1 }}>
          <OutfitMoodboard
            items={items}
            card={suggestion.card}
            title={title}
            compact={compact}
            imageMode={imageMode}
            variant={moodboardVariant}
          />

          {(!compact || showMetricsWhenCompact) && isCurrentCardSchema(suggestion.card) ? (
            <div style={{ marginTop: "20px", marginBottom: "16px" }}>
              <OutfitMetricCard card={suggestion.card} />
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span className="type-helper" style={{ fontSize: "13px", color: "var(--muted)" }}>
            Rate this look:
          </span>
          <div style={{ display: "flex", gap: "4px" }}>
            {[1, 2, 3, 4, 5].map((star) => (
              <span
                key={star}
                onMouseEnter={() => setHover(star)}
                onMouseLeave={() => setHover(0)}
                onClick={() => onRate(star)}
                style={{
                  cursor: "pointer",
                  fontSize: "20px",
                  color: star <= (hover || currentRating) ? "var(--gold)" : "var(--border)",
                }}
              >
                ★
              </span>
            ))}
          </div>
          {hasRating ? (
            <span className="type-helper" style={{ fontSize: "13px", color: "var(--muted)" }}>
              {suggestion.user_rating === 0 ? "Marked as not a match" : `You rated ${suggestion.user_rating}/5`}
            </span>
          ) : null}
        </div>
      </div>  {/* end .card */}
    </>
  );
}
