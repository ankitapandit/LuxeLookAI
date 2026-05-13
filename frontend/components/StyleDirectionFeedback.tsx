import type { CSSProperties } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

export type StyleDirectionFeedbackValue = "up" | "down" | null;

export default function StyleDirectionFeedback({
  value,
  busy = false,
  onChange,
}: {
  value: StyleDirectionFeedbackValue;
  busy?: boolean;
  onChange: (value: Exclude<StyleDirectionFeedbackValue, null>) => void;
}) {
  const baseButtonStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "34px",
    height: "34px",
    borderRadius: "999px",
    border: "1px solid rgba(212,169,106,0.16)",
    background: "rgba(255,255,255,0.03)",
    color: "rgba(255,247,237,0.70)",
    cursor: busy ? "wait" : "pointer",
    transition: "all 0.18s ease",
  } satisfies CSSProperties;

  return (
    <div
      style={{
        marginTop: "14px",
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: "10px",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: "12px",
          color: "rgba(255,247,237,0.60)",
        }}
      >
        Was this useful?
      </span>

      <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
        <button
          type="button"
          onClick={() => onChange("up")}
          disabled={busy}
          aria-label="This was useful"
          title="This was useful"
          style={{
            ...baseButtonStyle,
            color: value === "up" ? "#17120D" : baseButtonStyle.color,
            background: value === "up" ? "rgba(212,169,106,0.96)" : baseButtonStyle.background,
            border: value === "up" ? "1px solid rgba(212,169,106,0.96)" : baseButtonStyle.border,
            boxShadow: value === "up" ? "0 10px 22px rgba(212,169,106,0.18)" : "none",
          }}
        >
          <ThumbsUp size={15} />
        </button>

        <button
          type="button"
          onClick={() => onChange("down")}
          disabled={busy}
          aria-label="This was not useful"
          title="This was not useful"
          style={{
            ...baseButtonStyle,
            color: value === "down" ? "#17120D" : baseButtonStyle.color,
            background: value === "down" ? "rgba(212,169,106,0.96)" : baseButtonStyle.background,
            border: value === "down" ? "1px solid rgba(212,169,106,0.96)" : baseButtonStyle.border,
            boxShadow: value === "down" ? "0 10px 22px rgba(212,169,106,0.18)" : "none",
          }}
        >
          <ThumbsDown size={15} />
        </button>
      </div>
    </div>
  );
}
