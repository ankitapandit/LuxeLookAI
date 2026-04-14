/**
 * components/OutfitCard.tsx — Shared outfit metric card component
 *
 * Renders the compact at-a-glance metric card (Vibe Check, Color Theory,
 * Fit Check). Used on both the Events page (inline) and the
 * Archive page (history feed).
 */

import { OutfitCard as OutfitCardType } from "@/services/api";

/**
 * Returns true when the card has the current v2.0 schema (trend_stars present).
 * Used to skip rendering stale cards from earlier schema versions.
 */
export function isCurrentCardSchema(card: unknown): card is OutfitCardType {
  return (
    typeof card === "object" &&
    card !== null &&
    typeof (card as OutfitCardType).trend_stars === "number" &&
    typeof (card as OutfitCardType).vibe === "string"
  );
}

export default function OutfitMetricCard({ card }: { card: OutfitCardType }) {
  const rows: { icon: string; label: string; value: React.ReactNode }[] = [
    {
      icon: "💃",
      label: "Vibe Check",
      value: card.vibe,
    },
    {
      icon: "🎨",
      label: "Color Theory",
      value: card.color_theory,
    },
    {
      icon: "👗",
      label: "Fit Check",
      value: card.fit_check,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>

      {/* ── 3-row metric table ───────────────────────────────────────── */}
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        overflow: "hidden",
      }}>
        {rows.map((row, i) => (
          <div
            key={row.label}
            style={{
              display: "grid",
              gridTemplateColumns: "28px 1fr 1fr",
              alignItems: "center",
              gap: "0",
              padding: "11px 14px",
              borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none",
            }}
          >
            <span style={{ fontSize: "15px", lineHeight: 1 }}>{row.icon}</span>
            <span style={{
              fontSize: "11px", fontWeight: 600, color: "var(--muted)",
              textTransform: "uppercase", letterSpacing: "0.07em",
            }} className="type-micro">
              {row.label}
            </span>
            <span style={{
              fontSize: "13px", fontWeight: 600, color: "var(--ink)",
              textAlign: "right",
            }} className="type-helper">
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {/* ── Risk flag (only when present) ────────────────────────────── */}
      {card.risk_flag && (
        <div style={{
          marginTop: "8px",
          background: "rgba(180,120,60,0.08)",
          border: "1px solid rgba(180,120,60,0.25)",
          borderRadius: "10px",
          padding: "8px 14px",
          display: "flex", alignItems: "center", gap: "8px",
        }}>
          <span style={{ fontSize: "14px" }}>⚠️</span>
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>
            {card.risk_flag} — statement look. Own it or dial it back.
          </span>
        </div>
      )}

    </div>
  );
}
