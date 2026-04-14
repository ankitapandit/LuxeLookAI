import { useEffect, useState } from "react";
import { ShoppingBag, Shirt } from "lucide-react";

function TrousersIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 4h8l-1 6 2 10h-4l-1-6-1 6H7l2-10-1-6Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 4h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DressIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4c1 0 2 .8 2 1.8V7l2.4 1.8-1.5 2.5 3.1 7.9H6l3.1-7.9-1.5-2.5L10 7V5.8C10 4.8 11 4 12 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 7h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SweaterIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 5.5 7 7 4.5 9.5l2 2L8 10v9h8v-9l1.5 1.5 2-2L17 7l-2-1.5L13.8 7h-3.6L9 5.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 7h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function HeelsIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 15c2.4 0 4.5-.6 6.4-1.9l2.1-1.4 2 2.6H19c.6 0 1 .4 1 1v1H9.5c-2 0-3.8-.3-5.5-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.5 14.3 12 8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

type LoaderStep = {
  label: string;
  Icon: typeof Shirt;
};

const STEPS: LoaderStep[] = [
  { label: "Top", Icon: Shirt },
  { label: "Bottom", Icon: TrousersIcon as typeof Shirt },
  { label: "Dress", Icon: DressIcon as typeof Shirt },
  { label: "Shoes", Icon: HeelsIcon as typeof Shirt },
  { label: "Layer", Icon: SweaterIcon as typeof Shirt },
  { label: "Finish", Icon: ShoppingBag },
];

export default function LookAssemblyLoader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % STEPS.length);
    }, 850);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div
      style={{
        padding: "26px",
        borderRadius: "24px",
        border: "1px solid rgba(255,255,255,0.06)",
        background:
          "radial-gradient(circle at top right, rgba(212,169,106,0.10), transparent 26%), linear-gradient(180deg, #17130F 0%, #221C16 58%, #2A2018 100%)",
        boxShadow: "0 22px 54px rgba(0,0,0,0.16)",
        display: "grid",
        gap: "22px",
      }}
    >
      <div style={{ display: "grid", gap: "8px" }}>
        <p
          className="type-kicker"
          style={{
            margin: 0,
            fontSize: "11px",
            color: "rgba(247,240,230,0.56)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Outfit Assembly
        </p>
        <h3
          style={{
            margin: 0,
            fontFamily: "Playfair Display, serif",
            fontSize: "clamp(28px, 4vw, 40px)",
            lineHeight: 0.95,
            color: "#FFF7ED",
          }}
        >
          {title}
        </h3>
        <p style={{ margin: 0, color: "rgba(247,240,230,0.72)", lineHeight: 1.65, maxWidth: "34rem" }}>
          {subtitle}
        </p>
      </div>

      <div
        style={{
          borderRadius: "22px",
          border: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(255,255,255,0.03)",
          padding: "20px 16px 16px",
          display: "grid",
          gap: "18px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(88px, 1fr))",
            gap: "14px",
            alignItems: "start",
          }}
        >
          {STEPS.map(({ label, Icon }, index) => {
            const isActive = index === activeIndex;
            const isPast = index < activeIndex;
            return (
              <div
                key={label}
                style={{
                  padding: "6px 4px",
                  display: "grid",
                  justifyItems: "center",
                  gap: "10px",
                  transform: isActive ? "translateY(-2px)" : "none",
                  transition: "all 180ms ease",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    placeItems: "center",
                    color: isActive
                      ? "#D4A96A"
                      : isPast
                        ? "rgba(212,169,106,0.74)"
                        : "rgba(247,240,230,0.42)",
                    filter: isActive ? "drop-shadow(0 6px 16px rgba(212,169,106,0.18))" : "none",
                  }}
                >
                  <Icon size={24} />
                </div>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: isActive
                      ? "#FFF7ED"
                      : isPast
                        ? "rgba(247,240,230,0.76)"
                        : "rgba(247,240,230,0.46)",
                    textAlign: "center",
                    letterSpacing: "0.01em",
                  }}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        <div
          style={{
            height: "4px",
            borderRadius: "999px",
            background: "rgba(255,255,255,0.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${((activeIndex + 1) / STEPS.length) * 100}%`,
              height: "100%",
              borderRadius: "999px",
              background: "linear-gradient(90deg, rgba(212,169,106,0.72), rgba(212,169,106,1))",
              transition: "width 220ms ease",
            }}
          />
        </div>
      </div>
    </div>
  );
}
