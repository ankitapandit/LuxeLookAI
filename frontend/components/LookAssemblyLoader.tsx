import { useEffect, useState } from "react";
import { BriefcaseBusiness, Diamond, Footprints, Gem, ShoppingBag, Shirt } from "lucide-react";

type LoaderStep = {
  label: string;
  hint: string;
  Icon: typeof Shirt;
};

const STEPS: LoaderStep[] = [
  { label: "Top", hint: "pulling the lead piece into place", Icon: Shirt },
  { label: "Shape", hint: "balancing the silhouette", Icon: Diamond },
  { label: "Shoes", hint: "grounding the outfit", Icon: Footprints },
  { label: "Layer", hint: "testing the outer layer", Icon: BriefcaseBusiness },
  { label: "Jewelry", hint: "adding polish and contrast", Icon: Gem },
  { label: "Finish", hint: "settling the final touch", Icon: ShoppingBag },
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

  const activeStep = STEPS[activeIndex];

  return (
    <div
      style={{
        padding: "24px",
        borderRadius: "24px",
        border: "1px solid rgba(212,169,106,0.14)",
        background:
          "radial-gradient(circle at top right, rgba(212,169,106,0.10), transparent 28%), linear-gradient(180deg, rgba(251,247,239,0.88), rgba(245,236,221,0.80))",
        boxShadow: "0 18px 42px rgba(0,0,0,0.08)",
        display: "grid",
        gap: "20px",
      }}
    >
      <div style={{ display: "grid", gap: "8px" }}>
        <p
          className="type-kicker"
          style={{
            margin: 0,
            fontSize: "11px",
            color: "rgba(54,41,29,0.56)",
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
            color: "var(--charcoal)",
          }}
        >
          {title}
        </h3>
        <p style={{ margin: 0, color: "rgba(54,41,29,0.72)", lineHeight: 1.65, maxWidth: "34rem" }}>
          {subtitle}
        </p>
      </div>

      <div
        style={{
          borderRadius: "22px",
          border: "1px solid rgba(212,169,106,0.12)",
          background: "rgba(255,255,255,0.38)",
          padding: "18px",
          display: "grid",
          gap: "16px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))",
            gap: "12px",
          }}
        >
          {STEPS.map(({ label, Icon }, index) => {
            const isActive = index === activeIndex;
            const isPast = index < activeIndex;
            return (
              <div
                key={label}
                style={{
                  borderRadius: "18px",
                  padding: "14px 10px",
                  border: isActive
                    ? "1px solid rgba(212,169,106,0.36)"
                    : "1px solid rgba(54,41,29,0.08)",
                  background: isActive
                    ? "linear-gradient(180deg, rgba(212,169,106,0.22), rgba(212,169,106,0.08))"
                    : isPast
                      ? "rgba(212,169,106,0.10)"
                      : "rgba(255,255,255,0.42)",
                  display: "grid",
                  justifyItems: "center",
                  gap: "8px",
                  transform: isActive ? "translateY(-2px)" : "none",
                  transition: "all 180ms ease",
                }}
              >
                <div
                  style={{
                    width: "42px",
                    height: "42px",
                    borderRadius: "14px",
                    display: "grid",
                    placeItems: "center",
                    background: isActive ? "rgba(255,247,237,0.96)" : "rgba(54,41,29,0.05)",
                    color: isActive ? "var(--gold-deep)" : "rgba(54,41,29,0.62)",
                    boxShadow: isActive ? "0 10px 22px rgba(212,169,106,0.20)" : "none",
                  }}
                >
                  <Icon size={18} />
                </div>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: isActive ? "var(--charcoal)" : "rgba(54,41,29,0.66)",
                    textAlign: "center",
                  }}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ display: "grid", gap: "8px" }}>
          <div
            style={{
              height: "5px",
              borderRadius: "999px",
              background: "rgba(54,41,29,0.10)",
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
          <p style={{ margin: 0, color: "rgba(54,41,29,0.72)", fontSize: "13px", lineHeight: 1.5 }}>
            <span style={{ fontWeight: 600, color: "var(--charcoal)" }}>{activeStep.label}</span>
            {" · "}
            {activeStep.hint}
          </p>
        </div>
      </div>
    </div>
  );
}
