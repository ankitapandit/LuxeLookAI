import { useEffect, useState } from "react";
import { Expand, X } from "lucide-react";
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
  rank,
  wardrobeMap,
  onRate,
}: {
  suggestion: OutfitSuggestion;
  rank: number;
  wardrobeMap: Record<string, ClothingItem>;
  onRate: (rating: number) => void;
}) {
  const [hover, setHover] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const items = [...suggestion.item_ids, ...(suggestion.accessory_ids || [])]
    .map((id) => wardrobeMap[id])
    .filter(Boolean);
  const title = getOutfitTitle(suggestion, wardrobeMap);
  const currentRating = suggestion.user_rating ?? 0;
  const hasRating = suggestion.user_rating !== null && suggestion.user_rating !== undefined;

  useEffect(() => {
    if (!expanded) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [expanded]);

  return (
    <>
      <div className="card fade-up" style={{ padding: "24px" }}>
        <OutfitMoodboard
          items={items}
          card={suggestion.card}
          title={title}
          eyebrow={`Look #${rank}`}
          scoreLabel={`${Math.round(suggestion.score * 100)}% match`}
        />

        <div style={{ marginTop: "16px", marginBottom: "16px", display: "flex", justifyContent: "flex-end" }}>
          <button
            className="btn-secondary"
            onClick={() => setExpanded(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: "7px", fontSize: "12px" }}
          >
            <Expand size={14} />
            View full board
          </button>
        </div>

        {isCurrentCardSchema(suggestion.card) ? (
          <div style={{ marginBottom: "16px" }}>
            <OutfitMetricCard card={suggestion.card} />
          </div>
        ) : null}

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
      </div>

      {expanded ? (
        <div
          className="moodboard-modal-backdrop"
          onClick={() => setExpanded(false)}
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(8, 7, 6, 0.82)",
            backdropFilter: "blur(8px)",
            zIndex: 1300,
            padding: "24px",
            overflowY: "auto",
          }}
        >
          <div
            className="moodboard-modal-panel"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Expanded moodboard for look ${rank}`}
            style={{
              maxWidth: "1240px",
              margin: "0 auto",
              background: "#13110D",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "28px",
              boxShadow: "0 28px 70px rgba(0,0,0,0.35)",
              padding: "22px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
              <button
                className="btn-secondary"
                onClick={() => setExpanded(false)}
                style={{ display: "inline-flex", alignItems: "center", gap: "7px", fontSize: "12px" }}
              >
                <X size={14} />
                Close
              </button>
            </div>

            <OutfitMoodboard
              items={items}
              card={suggestion.card}
              title={title}
              eyebrow={`Look #${rank}`}
              scoreLabel={`${Math.round(suggestion.score * 100)}% match`}
              expanded
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
