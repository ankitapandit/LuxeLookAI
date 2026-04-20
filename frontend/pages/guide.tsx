import type { ReactNode } from "react";
import Head from "next/head";
import Navbar from "@/components/layout/Navbar";
import { Shirt, UserRound, Sparkles, Ruler, Palette, Layers3 } from "lucide-react";

type AtlasItem = {
  label: string;
  note: string;
  svg: ReactNode;
};

const DRESS_CODE_STEPS = [
  { label: "Casual", cue: "easy, practical, everyday" },
  { label: "Smart Casual", cue: "elevated but relaxed" },
  { label: "Business Casual", cue: "work-ready, polished comfort" },
  { label: "Business Formal", cue: "structured, office-professional, sharp" },
  { label: "Cocktail", cue: "dressy, social, after-dark" },
  { label: "Black Tie", cue: "formal, refined, highest polish" },
];

const SEASON_RULES = [
  { label: "Spring", tone: "#9DBB82", hint: "light layers, mild weather, flexible fabrics" },
  { label: "Summer", tone: "#D7B562", hint: "airy fabrics, open shoes, heat-friendly coverage" },
  { label: "Fall", tone: "#A77249", hint: "richer textures, boots, medium warmth" },
  { label: "Winter", tone: "#7C8598", hint: "warmth, insulation, heavier layers" },
  { label: "All-season", tone: "#B5A894", hint: "works across mild weather with easy layering" },
];

function necklineFigure(detail: ReactNode) {
  return (
    <>
      <circle cx="40" cy="14" r="7" fill="none" />
      <path d="M25 53V37q0-8 7-12q4-2 8-2q4 0 8 2q7 4 7 12v16" fill="none" />
      {detail}
    </>
  );
}

function fitFigure(shape: ReactNode) {
  return (
    <>
      {shape}
    </>
  );
}

function lengthFigure(shape: ReactNode, arrow: ReactNode) {
  return (
    <>
      <circle cx="30" cy="13" r="6" fill="none" />
      <path
        d="M20 26q4-4 10-4q6 0 10 4l2 9q1 3-1 4l-2-1v8l3 16q1 3-2 3h-3l-3-16h-1l-3 16h-3q-3 0-2-3l3-16v-8l-2 1q-2-1-1-4z"
        fill="none"
      />
      {shape}
      {arrow}
    </>
  );
}

function verticalArrow(y1: number, y2: number) {
  return (
    <>
      <path d={`M58 ${y1}V${y2}`} fill="none" />
      <path d={`M55 ${y1 + 4}l3-4l3 4`} fill="none" />
      <path d={`M55 ${y2 - 4}l3 4l3-4`} fill="none" />
    </>
  );
}

const NECKLINE_ATLAS: AtlasItem[] = [
  {
    label: "Crew",
    note: "high and clean near the neck",
    svg: necklineFigure(<path d="M31 31q9 4 18 0" fill="none" />),
  },
  {
    label: "Round",
    note: "soft curved opening",
    svg: necklineFigure(<path d="M30 31q10 11 20 0" fill="none" />),
  },
  {
    label: "Boat",
    note: "wide and horizontal across the shoulders",
    svg: necklineFigure(<path d="M27 31q13-6 26 0" fill="none" />),
  },
  {
    label: "V-neck",
    note: "opens the chest vertically",
    svg: necklineFigure(<path d="M31 28l9 11l9-11" fill="none" />),
  },
  {
    label: "Plunging",
    note: "a deeper V shape",
    svg: necklineFigure(<path d="M31 28l9 18l9-18" fill="none" />),
  },
  {
    label: "Jewel",
    note: "small, neat, and close to the collarbone",
    svg: necklineFigure(<path d="M34 29q6 3 12 0" fill="none" />),
  },
  {
    label: "Square",
    note: "straight across with clean corners",
    svg: necklineFigure(<path d="M32 30v7h16v-7" fill="none" />),
  },
  {
    label: "Scoop",
    note: "rounded and more open than round",
    svg: necklineFigure(<path d="M29 28q11 14 22 0" fill="none" />),
  },
  {
    label: "Sweetheart",
    note: "curved shape through the bust",
    svg: necklineFigure(<path d="M31 34q4-7 9-1q5-6 9 1" fill="none" />),
  },
  {
    label: "Off-shoulder",
    note: "sits below both shoulders",
    svg: necklineFigure(<path d="M26 36q14-5 28 0" fill="none" />),
  },
  {
    label: "Strapless",
    note: "straight across with no straps",
    svg: necklineFigure(<path d="M31 37h18" fill="none" />),
  },
  {
    label: "Halter",
    note: "cuts in at the shoulders and ties high",
    svg: necklineFigure(
      <>
        <path d="M33 33q7 7 14 0" fill="none" />
        <path d="M36 24l4 8l4-8" fill="none" />
      </>
    ),
  },
  {
    label: "High neck",
    note: "higher coverage above the collarbone",
    svg: necklineFigure(<path d="M34 24v8h12v-8" fill="none" />),
  },
  {
    label: "Turtleneck",
    note: "high neck with a taller collar",
    svg: necklineFigure(<path d="M34 21v13h12V21" fill="none" />),
  },
  {
    label: "Collar",
    note: "shirt-style points at the neck",
    svg: necklineFigure(
      <>
        <path d="M33 25l6 8" fill="none" />
        <path d="M47 25l-6 8" fill="none" />
      </>
    ),
  },
  {
    label: "Cowl",
    note: "soft drape through the neckline",
    svg: necklineFigure(<path d="M31 28q4 8 9 5q5-2 9 3" fill="none" />),
  },
  {
    label: "One shoulder",
    note: "single-strap asymmetry",
    svg: necklineFigure(<path d="M29 35q9-12 22-4" fill="none" />),
  },
  {
    label: "Tie neck",
    note: "neckline finished with a tie or bow",
    svg: necklineFigure(
      <>
        <path d="M33 26q7 7 14 0" fill="none" />
        <path d="M40 30v10" fill="none" />
        <path d="M40 34l-4 8M40 34l4 8" fill="none" />
      </>
    ),
  },
  {
    label: "Apron neck",
    note: "high neckline with broad shoulder cut-in",
    svg: necklineFigure(<path d="M32 35q8-15 16 0" fill="none" />),
  },
  {
    label: "Queen anne",
    note: "sweetheart shape with higher side coverage",
    svg: necklineFigure(
      <>
        <path d="M31 34q4-10 9-1q5-9 9 1" fill="none" />
        <path d="M31 34q2-6 5-10" fill="none" />
        <path d="M49 34q-2-6-5-10" fill="none" />
      </>
    ),
  },
  {
    label: "Asymmetrical",
    note: "angled neckline across the body",
    svg: necklineFigure(<path d="M30 36q8-10 22-5" fill="none" />),
  },
  {
    label: "Keyhole neck",
    note: "small opening cut into a higher neckline",
    svg: necklineFigure(
      <>
        <path d="M32 27q8 5 16 0" fill="none" />
        <path d="M40 31q-2 4 0 7q2-3 0-7" fill="none" />
      </>
    ),
  },
  {
    label: "Scalloped neck",
    note: "soft repeated curves along the edge",
    svg: necklineFigure(<path d="M30 29q2 4 5 0q2 4 5 0q2 4 5 0q2 4 5 0" fill="none" />),
  },
  {
    label: "Illusion neck",
    note: "higher sheer layer over a lower base line",
    svg: necklineFigure(
      <>
        <path d="M30 25q10-7 20 0" fill="none" strokeDasharray="3 3" />
        <path d="M31 33q4-7 9 0q5-7 9 0" fill="none" />
      </>
    ),
  },
];

const FIT_ATLAS: AtlasItem[] = [
  {
    label: "Slim",
    note: "closer to the body without heavy volume",
    svg: fitFigure(<path d="M34 18l-8 14v30h28V32l-8-14" fill="none" />),
  },
  {
    label: "Regular",
    note: "balanced shape through torso and leg",
    svg: fitFigure(<path d="M30 18l-10 14v30h36V32L46 18" fill="none" />),
  },
  {
    label: "Relaxed",
    note: "easier drape and more movement",
    svg: fitFigure(<path d="M28 18l-12 16v28h40V34L44 18" fill="none" />),
  },
  {
    label: "Oversized",
    note: "intentionally roomy and loose",
    svg: fitFigure(<path d="M24 18L10 36v26h52V36L48 18" fill="none" />),
  },
];

const LENGTH_ATLAS: AtlasItem[] = [
  {
    label: "Mini",
    note: "above the knee",
    svg: lengthFigure(<></>, verticalArrow(26, 40)),
  },
  {
    label: "Midi",
    note: "below the knee, above the ankle",
    svg: lengthFigure(<></>, verticalArrow(26, 50)),
  },
  {
    label: "Maxi / full-length",
    note: "near the ankle or floor",
    svg: lengthFigure(<></>, verticalArrow(26, 61)),
  },
];

const PROFILE_ROWS = [
  {
    title: "Used directly in suggestions",
    note: "These help the app make fit, proportion, color, and framing decisions.",
    bullets: [
      "Body type and shoulders help balance silhouettes and necklines.",
      "Height and proportions help with rise, length, and scale.",
      "Complexion helps with color harmony and contrast choices.",
      "Face shape can influence neckline, earrings, eyewear, and hair framing.",
      "Hair length and texture can inform hair + makeup styling suggestions.",
    ],
  },
  {
    title: "Optional context only",
    note: "Used carefully, and only when it adds helpful context rather than rules.",
    bullets: [
      "Age range may influence polish, comfort, and context sensitivity at a high level.",
    ],
  },
  {
    title: "Not used as style rules",
    note: "We do not want the app making outfit rules from sensitive or low-signal assumptions.",
    bullets: [
      "Ethnicity is not a direct outfit-ranking rule.",
      "Fitness is not used as a styling variable.",
      "You can skip any profile field and still use LuxeLook normally.",
    ],
  },
];

function VisualTile({ item }: { item: AtlasItem }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "96px auto",
        alignContent: "start",
        justifyItems: "center",
        gap: "10px",
        padding: "14px",
        width: "156px",
        minWidth: "156px",
        minHeight: "182px",
        borderRadius: "18px",
        border: "1px solid rgba(255,255,255,0.10)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
      }}
    >
      <svg viewBox="0 0 80 80" style={{ width: "100%", maxWidth: "88px", height: "88px" }} aria-hidden="true">
        <g stroke="rgba(232,196,138,0.92)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          {item.svg}
        </g>
      </svg>
      <div style={{ width: "100%" }}>
        <p className="type-helper" style={{ color: "var(--charcoal)", fontWeight: 600 }}>{item.label}</p>
        <p className="type-micro" style={{ color: "var(--muted)", marginTop: "4px" }}>{item.note}</p>
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div style={{ display: "grid", gap: "10px", maxWidth: "760px" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", color: "var(--gold)" }}>
        {icon}
        <span className="type-kicker">{title}</span>
      </div>
      <h2 className="type-page-title" style={{ fontSize: "clamp(28px, 4vw, 42px)", color: "var(--charcoal)" }}>
        {title}
      </h2>
      <p className="type-body" style={{ color: "var(--muted)", maxWidth: "720px" }}>
        {body}
      </p>
    </div>
  );
}

const RAIL_CARD_STYLE: React.CSSProperties = {
  display: "grid",
  gap: "10px",
  padding: "14px",
  minWidth: "180px",
  borderRadius: "16px",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
};

function HorizontalRail({ children }: { children: ReactNode }) {
  return (
    <div style={{ maxWidth: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          gap: "12px",
          width: "100%",
          maxWidth: "100%",
          overflowX: "auto",
          paddingBottom: "6px",
          scrollbarWidth: "thin",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function AtlasRail({ title, items }: { title: string; items: AtlasItem[] }) {
  return (
    <div style={{ maxWidth: "100%", overflow: "hidden" }}>
      <p className="type-helper" style={{ color: "var(--charcoal)", fontWeight: 600, marginBottom: "10px" }}>{title}</p>
      <div
        style={{
          display: "flex",
          gap: "10px",
          width: "100%",
          maxWidth: "100%",
          overflowX: "auto",
          paddingBottom: "6px",
          scrollbarWidth: "thin",
        }}
      >
        {items.map((item) => <VisualTile key={item.label} item={item} />)}
      </div>
    </div>
  );
}

export default function GuidePage() {
  return (
    <>
      <Head><title>Guide — LuxeLook AI</title></Head>
      <Navbar />

      <main className="page-main" style={{ maxWidth: "1240px", margin: "0 auto", padding: "40px 24px 72px" }}>
        <div className="fade-up" style={{ display: "grid", gap: "40px" }}>

          <section
            style={{
              display: "grid",
              gap: "28px",
              padding: "28px",
              borderRadius: "30px",
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <SectionHeader
              icon={<Shirt size={18} />}
              title="Wardrobe & Fashion Terms"
              body="These are the labels the wardrobe editor and recommendation engine use most often. Think of them as the building blocks of silhouette, polish, weather fit, and occasion fit."
            />

            <div
              style={{
                display: "grid",
                gap: "18px",
                alignItems: "start",
              }}
            >
              <div style={{ padding: "18px", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                    <Sparkles size={16} color="var(--gold)" />
                    <h3 className="type-section-title" style={{ color: "var(--charcoal)" }}>Dress code ladder</h3>
                  </div>
                  <HorizontalRail>
                    {DRESS_CODE_STEPS.map((step, index) => (
                      <div key={step.label} style={RAIL_CARD_STYLE}>
                        <div
                          style={{
                            height: "8px",
                            borderRadius: "999px",
                            background: index >= 2
                              ? "linear-gradient(90deg, rgba(212,169,106,0.22), rgba(232,196,138,0.30))"
                              : "rgba(255,255,255,0.08)",
                            border: "1px solid rgba(255,255,255,0.08)",
                          }}
                        />
                        <div>
                          <p className="type-helper" style={{ color: "var(--charcoal)", fontWeight: 600 }}>{step.label}</p>
                          <p className="type-micro" style={{ color: "var(--muted)", marginTop: "4px" }}>{step.cue}</p>
                        </div>
                      </div>
                    ))}
                  </HorizontalRail>
              </div>

              <div style={{ padding: "18px", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                    <Layers3 size={16} color="var(--gold)" />
                    <h3 className="type-section-title" style={{ color: "var(--charcoal)" }}>Season readings</h3>
                  </div>
                  <HorizontalRail>
                    {SEASON_RULES.map((rule) => (
                      <div key={rule.label} style={RAIL_CARD_STYLE}>
                        <span
                          className="type-micro"
                          style={{
                            display: "inline-flex",
                            justifyContent: "center",
                            width: "fit-content",
                            padding: "8px 10px",
                            borderRadius: "999px",
                            color: "#120F0A",
                            background: rule.tone,
                            fontWeight: 700,
                          }}
                        >
                          {rule.label}
                        </span>
                        <p className="type-helper" style={{ color: "var(--muted)" }}>{rule.hint}</p>
                      </div>
                    ))}
                  </HorizontalRail>
                  <p className="type-micro" style={{ color: "var(--muted)", marginTop: "12px" }}>
                    The app looks at warmth, fabric, coverage, shoe practicality, and event weather together, not just the season tag alone.
                  </p>
              </div>

              <div style={{ padding: "18px", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                  <Palette size={16} color="var(--gold)" />
                  <h3 className="type-section-title" style={{ color: "var(--charcoal)" }}>Descriptor quick guide</h3>
                </div>
                <div style={{ display: "grid", gap: "12px" }}>
                  <AtlasRail title="Necklines" items={NECKLINE_ATLAS} />
                  <AtlasRail title="Fit" items={FIT_ATLAS} />
                  <AtlasRail title="Length" items={LENGTH_ATLAS} />
                </div>
              </div>
            </div>
          </section>

          <section
            style={{
              display: "grid",
              gap: "28px",
              padding: "28px",
              borderRadius: "30px",
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <SectionHeader
              icon={<UserRound size={18} />}
              title="How Your Profile Shapes Suggestions"
              body="Profile details are there to improve proportion, color, framing, and practicality. They should help the app feel more personal, not more judgmental."
            />

            <div style={{ display: "grid", gap: "18px", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
              <div style={{ display: "grid", gap: "14px" }}>
                <div style={{ padding: "18px", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                    <Ruler size={16} color="var(--gold)" />
                    <h3 className="type-section-title" style={{ color: "var(--charcoal)" }}>Measurements & proportion</h3>
                  </div>
                  <div style={{ display: "grid", gap: "14px", gridTemplateColumns: "120px 1fr", alignItems: "center" }}>
                    <svg viewBox="0 0 120 160" style={{ width: "120px", height: "160px" }} aria-hidden="true">
                      <g fill="none" stroke="rgba(232,196,138,0.9)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="60" cy="20" r="12" />
                        <path d="M60 32v24M34 60c6-10 18-14 26-14 8 0 20 4 26 14M44 76c6 6 10 10 16 10s10-4 16-10M38 98c10-6 22-8 44 0M46 110v28M74 110v28" />
                        <path d="M22 60h76M28 76h64M20 98h80" strokeDasharray="4 4" />
                      </g>
                      <g fill="rgba(240,235,226,0.8)" fontSize="9" fontFamily="DM Sans, sans-serif">
                        <text x="6" y="58">bust</text>
                        <text x="6" y="80">waist</text>
                        <text x="6" y="102">hips</text>
                      </g>
                    </svg>
                    <div style={{ display: "grid", gap: "8px" }}>
                      <p className="type-helper" style={{ color: "var(--muted)" }}>
                        Body measurements and body type help the app choose better balance: where to define the waist, when to elongate, and when to add or reduce volume.
                      </p>
                      <p className="type-helper" style={{ color: "var(--muted)" }}>
                        Height and proportions help with rise, hem length, sleeve scale, and how much volume tends to feel harmonious.
                      </p>
                    </div>
                  </div>
                </div>

                <div style={{ padding: "18px", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                    <Sparkles size={16} color="var(--gold)" />
                    <h3 className="type-section-title" style={{ color: "var(--charcoal)" }}>Face shape, complexion, hair</h3>
                  </div>
                  <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                    {[
                      {
                        label: "Oval",
                        svg: <path d="M24 11c10 0 16 8 16 21c0 14-7 24-16 24s-16-10-16-24c0-13 6-21 16-21z" />,
                      },
                      {
                        label: "Round",
                        svg: <path d="M24 13c9 0 15 7 15 18s-6 19-15 19S9 42 9 31s6-18 15-18z" />,
                      },
                      {
                        label: "Square",
                        svg: <path d="M16 14c2-2 5-3 8-3s6 1 8 3c3 3 4 8 4 15c0 6-1 11-3 16c-2 6-6 10-12 10s-10-4-12-10c-2-5-3-10-3-16c0-7 1-12 4-15c2-2 5-3 8-3z" />,
                      },
                      {
                        label: "Heart",
                        svg: <path d="M24 10c10 0 17 7 17 15c0 5-2 10-5 15c-3 5-7 11-12 17c-5-6-9-12-12-17c-3-5-5-10-5-15c0-8 7-15 17-15z" />,
                      },
                      {
                        label: "Diamond",
                        svg: <path d="M24 11c6 0 11 4 14 10c2 4 3 8 3 12s-1 8-3 12c-3 7-8 12-14 12s-11-5-14-12c-2-4-3-8-3-12s1-8 3-12c3-6 8-10 14-10z" />,
                      },
                      {
                        label: "Oblong",
                        svg: <path d="M24 8c8 0 14 7 14 21c0 16-6 28-14 28S10 45 10 29c0-14 6-21 14-21z" />,
                      },
                    ].map((face) => (
                      <div key={face.label} style={{ display: "grid", gap: "8px", justifyItems: "center", padding: "10px", borderRadius: "14px", background: "rgba(255,255,255,0.03)" }}>
                        <svg viewBox="0 0 48 64" style={{ width: "48px", height: "58px" }} aria-hidden="true">
                          <g fill="rgba(232,196,138,0.88)">
                            {face.svg}
                          </g>
                        </svg>
                        <span className="type-micro" style={{ color: "var(--muted)" }}>{face.label}</span>
                      </div>
                    ))}
                  </div>
                  <p className="type-helper" style={{ color: "var(--muted)", marginTop: "12px" }}>
                    Face shape can influence earrings, eyewear, necklines, and hair framing. Complexion helps with color harmony. Hair length and texture help shape hair and makeup styling suggestions.
                  </p>
                </div>
              </div>

              <div style={{ display: "grid", gap: "14px" }}>
                {PROFILE_ROWS.map((row) => (
                  <div key={row.title} style={{ padding: "18px", borderRadius: "20px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
                    <p className="type-helper" style={{ color: "var(--charcoal)", fontWeight: 700 }}>{row.title}</p>
                    <p className="type-micro" style={{ color: "var(--muted)", marginTop: "4px", marginBottom: "12px" }}>{row.note}</p>
                    <div style={{ display: "grid", gap: "8px" }}>
                      {row.bullets.map((bullet) => (
                        <div key={bullet} style={{ display: "grid", gridTemplateColumns: "12px 1fr", gap: "8px" }}>
                          <span style={{ color: "var(--gold)" }}>•</span>
                          <span className="type-helper" style={{ color: "var(--muted)" }}>{bullet}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
