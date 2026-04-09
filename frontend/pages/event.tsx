/**
 * pages/event.tsx — Event input page
 * User describes an event in natural language; AI parses it.
 * On success, generates looks for the current event.
 */

import { useEffect, useState } from "react";
import Head from "next/head";
import Navbar from "@/components/layout/Navbar";
import { createEvent, generateOutfits, resetFeedback, getWardrobeItems, rateOutfit, OutfitSuggestion, ClothingItem } from "@/services/api";
import OutfitSuggestionCard from "@/components/OutfitSuggestionCard";
import { CalendarDays, ChevronDown, Sparkles, Info, X, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";

// Example prompts to inspire the user
const EXAMPLES = [
  "Black-tie gala at the art museum on Saturday evening",
  "Casual brunch with friends on Sunday morning",
  "Job interview at a tech startup this Tuesday",
  "Outdoor birthday party at the park, warm afternoon",
  "First date at a cozy wine bar, smart casual",
];

function titleCase(value: string): string {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getColorFamily(color?: string): string {
  const value = (color || "").toLowerCase();
  if (!value) return "neutral";
  if (/(pink|blush|rose|mauve|fuchsia|magenta)/.test(value)) return "pink";
  if (/(white|ivory|cream|beige|tan|camel|khaki|sand|nude|stone)/.test(value)) return "light neutral";
  if (/(black|charcoal|ebony|onyx)/.test(value)) return "dark neutral";
  if (/(brown|chocolate|espresso|cocoa|taupe)/.test(value)) return "earth";
  if (/(blue|navy|indigo|cobalt|denim|teal)/.test(value)) return "blue";
  if (/(green|sage|olive|mint|forest)/.test(value)) return "green";
  if (/(red|burgundy|wine|maroon|rust|coral|orange|peach|yellow|gold)/.test(value)) return "warm";
  if (/(grey|gray|silver)/.test(value)) return "cool neutral";
  return "neutral";
}

function findMatchingItem(items: ClothingItem[], categories: string[], accessorySubtypes: string[] = []): ClothingItem | undefined {
  const categorySet = new Set(categories.map((value) => value.toLowerCase()));
  const subtypeSet = new Set(accessorySubtypes.map((value) => value.toLowerCase()));

  return items.find((candidate) => {
    const category = (candidate.category || "").toLowerCase();
    if (categorySet.has(category)) return true;
    const subtype = (candidate.accessory_subtype || "").toLowerCase();
    return category === "accessories" && subtypeSet.size > 0 && Array.from(subtypeSet).some((needle) => subtype.includes(needle));
  });
}

function describeSuggestedItem(item: ClothingItem | undefined, fallback: string): string {
  if (!item) return fallback;
  const title = item.accessory_subtype ? titleCase(item.accessory_subtype) : titleCase(item.category);
  const details = [item.color, item.season].filter(Boolean).map((value) => titleCase(String(value)));
  return details.length > 0 ? `${title} · ${details.join(" · ")}` : title;
}

type StyleDirectionBand = {
  items: { label: string; value: string }[];
};

function buildStyleDirection(
  suggestion: OutfitSuggestion | null,
  wardrobeMap: Record<string, ClothingItem>,
): { title: string; intro: string; bands: StyleDirectionBand[]; final: string; avoid: string } | null {
  if (!suggestion) return null;

  const items = [...suggestion.item_ids, ...(suggestion.accessory_ids || [])]
    .map((id) => wardrobeMap[id])
    .filter(Boolean);
  if (!items.length) return null;

  const anchor = items[0];
  const colorFamily = getColorFamily(anchor?.color);
  const vibeText = (suggestion.card?.vibe || "").toLowerCase();
  const weatherSyncText = (suggestion.card?.weather_sync || "").toLowerCase();

  const topItem = findMatchingItem(items, ["tops"]);
  const bottomItem = findMatchingItem(items, ["bottoms"]);
  const dressItem = findMatchingItem(items, ["dresses"]);
  const shoeItem = findMatchingItem(items, ["shoes"]);
  const outerwearItem = findMatchingItem(items, ["outerwear"]);
  const jewelryItem = findMatchingItem(items, [], ["jewelry", "necklace", "earring", "bracelet", "ring", "watch"]);

  const baseBand = dressItem
    ? [{ label: "Dress", value: describeSuggestedItem(dressItem, "A clean dress silhouette") }]
    : [
        { label: "Top", value: describeSuggestedItem(topItem, "Clean fitted top or bodysuit") },
        { label: "Bottom", value: describeSuggestedItem(bottomItem, "Tailored trouser, straight skirt, or clean denim") },
      ];

  const supportBand = [
    { label: "Shoes", value: describeSuggestedItem(shoeItem, "Simple heel or polished flat") },
    { label: "Outerwear", value: describeSuggestedItem(outerwearItem, "Light blazer, wrap, or cardigan") },
  ];

  const finishBand = [
    { label: "Hair", value: vibeText.includes("confident") || vibeText.includes("statement") ? "Sleek bun or polished blowout" : "Soft waves or a polished bun" },
    { label: "Makeup", value: colorFamily === "pink" || colorFamily === "warm" ? "Glow-forward skin and a soft lip" : "Clean skin, soft definition, and a neutral lip" },
    { label: "Jewelry", value: describeSuggestedItem(jewelryItem, "Gold hoops or a delicate chain") },
  ];

  return {
    title: "What works best",
    intro: "If you do not love the looks above, here is the cleaner direction I would take with this look.",
    bands: [{ items: baseBand }, { items: supportBand }, { items: finishBand }],
    final: "Keep the styling cohesive, let one piece lead, and avoid anything that fights the shape or texture of the outfit.",
    avoid: weatherSyncText.includes("indoor") || weatherSyncText.includes("mild")
      ? "Avoid anything that feels too heavy or overworked for the setting."
      : "Avoid anything that fights the shape, texture, or weather of the outfit.",
  };
}

export default function EventsPage() {
  const [text,           setText]           = useState("");
  const [loading,        setLoading]        = useState(false);
  const [eventId,        setEventId]        = useState<string | null>(null);
  const [suggestions,    setSuggestions]    = useState<OutfitSuggestion[]>([]);
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);
  const [wardrobeMap,    setWardrobeMap]    = useState<Record<string, ClothingItem>>({});
  // Accumulated suggestion IDs shown across all regenerates this session
  const [allShownIds,    setAllShownIds]    = useState<string[]>([]);
  // True when every returned outfit was previously seen (wardrobe variety exhausted)
  const [allSeen,         setAllSeen]         = useState(false);
  // Plain-English hints about missing item types that would unlock more templates
  const [coverageHints,   setCoverageHints]   = useState<string[]>([]);
  // Controls visibility of the "None of these work" tooltip
  const [showBadTip,      setShowBadTip]      = useState(false);
  const [showExpertSuggestion, setShowExpertSuggestion] = useState(true);

  useEffect(() => {
    setActiveSuggestionId(suggestions[0]?.id ?? null);
  }, [suggestions]);

  const activeSuggestion = suggestions.find((suggestion) => suggestion.id === activeSuggestionId) || suggestions[0] || null;
  const styleDirection = buildStyleDirection(activeSuggestion, wardrobeMap);

  async function handleGenerate() {
    if (!text.trim()) return;
    setLoading(true);
    setSuggestions([]);
    setAllShownIds([]);
    setAllSeen(false);
    try {
      const event = await createEvent(text);
      setEventId(event.id);
      const [outfitData, items] = await Promise.all([
        generateOutfits(event.id, 5),
        getWardrobeItems(),
      ]);
      const map: Record<string, ClothingItem> = {};
      items.forEach(i => { map[i.id] = i; });
      setWardrobeMap(map);
      setSuggestions(outfitData.suggestions);
      const newIds = outfitData.suggestions.map(s => s.id);
      setAllShownIds(newIds);
      setAllSeen(outfitData.all_seen ?? false);
      setCoverageHints(outfitData.coverage_hints ?? []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e?.response?.data?.detail || "Could not generate looks");
    } finally {
      setLoading(false);
    }
  }

  async function _regenerate(markAsBad: boolean) {
    if (!eventId) return;
    setLoading(true);
    setSuggestions([]);
    try {
      const [outfitData, items] = await Promise.all([
        // Accumulate all seen IDs so previously-shown combos stay downranked
        generateOutfits(eventId, 5, allShownIds, markAsBad),
        getWardrobeItems(),
      ]);
      const map: Record<string, ClothingItem> = {};
      items.forEach(i => { map[i.id] = i; });
      setWardrobeMap(map);
      setSuggestions(outfitData.suggestions);
      // Accumulate new IDs into the session history
      setAllShownIds(prev => [...prev, ...outfitData.suggestions.map(s => s.id)]);
      setAllSeen(outfitData.all_seen ?? false);
      setCoverageHints(outfitData.coverage_hints ?? []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e?.response?.data?.detail || "Could not refresh looks");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    if (!eventId) return;
    try {
      await resetFeedback(eventId);
      setAllShownIds([]);
      setAllSeen(false);
      setSuggestions([]);
      toast.success("Feedback reset — generating fresh looks…");
      await handleGenerate();
    } catch {
      toast.error("Could not reset feedback");
    }
  }

  async function handleRate(outfitId: string, rating: number) {
    try {
      await rateOutfit(outfitId, rating);
      setSuggestions(prev => prev.map(s => s.id === outfitId ? { ...s, user_rating: rating } : s));
      toast.success("Rating saved!");
    } catch {
      toast.error("Could not save rating");
    }
  }

  return (
    <>
      <Head><title>Event — LuxeLook AI</title></Head>
      <Navbar />

      <main className="page-main" style={{ maxWidth: "680px", margin: "0 auto", padding: "64px 24px" }}>
        <div className="fade-up">
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <CalendarDays size={24} color="var(--gold)" />
            <h1 className="type-page-title" style={{ fontSize: "36px", color: "var(--charcoal)" }}>
              Describe your event
            </h1>
          </div>
          <p className="type-page-subtitle" style={{ color: "var(--muted)", fontSize: "16px", marginBottom: "40px" }}>
            Describe your event in plain English. Our AI will read the context
            and build the right looks from your wardrobe.
          </p>

          {/* ── Text input ─────────────────────────────────────────────── */}
          <textarea
            className="input"
            value={text}
            onChange={(e) => { setText(e.target.value); setEventId(null); setSuggestions([]); }}
            placeholder="e.g. 'Rooftop cocktail party this Friday evening, smart casual'"
            rows={4}
            style={{ resize: "vertical", lineHeight: 1.6 }}
          />

          {/* ── Example prompts ────────────────────────────────────────── */}
          <div style={{ marginTop: "16px", marginBottom: "32px" }}>
            <p className="type-kicker" style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Try an example
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => { setText(ex); setEventId(null); setSuggestions([]); }}
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "20px",
                    padding: "6px 14px",
                    fontSize: "13px",
                    color: "var(--ink)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                  className="type-chip"
                >
                  {ex.length > 40 ? ex.slice(0, 40) + "…" : ex}
                </button>
              ))}
            </div>
          </div>

          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={!text.trim() || loading}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
          >
            <Sparkles size={16} />
            {loading ? "Generating looks…" : "Generate Looks"}
          </button>

          {/* ── Generating spinner ── */}
          {loading && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{
                width: "40px", height: "40px", margin: "0 auto 16px",
                border: "3px solid var(--border)", borderTop: "3px solid var(--gold)",
                borderRadius: "50%", animation: "spin 0.8s linear infinite",
              }} />
              <p style={{ fontWeight: 600, fontSize: "15px", color: "var(--charcoal)", marginBottom: "12px" }}>
                Building your looks…
              </p>
              <div style={{ width: "200px", height: "3px", background: "var(--border)", borderRadius: "2px", margin: "0 auto" }}>
                <div style={{ height: "100%", borderRadius: "2px", background: "var(--gold)", animation: "progress 3s ease-in-out infinite" }} />
              </div>
              <style>{`
                @keyframes spin     { to { transform: rotate(360deg); } }
                @keyframes progress { from { width: 20% } to { width: 85% } }
              `}</style>
            </div>
          )}

          {/* ── Outfit suggestions ── */}
          {suggestions.length > 0 && !loading && (
            <div style={{ marginTop: "40px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                <h2 className="type-section-title" style={{ fontSize: "22px", fontFamily: "Playfair Display, serif", color: "var(--charcoal)" }}>
                  Suggested Looks
                </h2>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {/* Neutral regenerate — no ratings written */}
                  <button
                    className="btn-secondary"
                    onClick={() => _regenerate(false)}
                    style={{ fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <Sparkles size={13} /> More looks
                  </button>

                  {/* Explicit negative — writes user_rating=0 on unrated shown suggestions */}
                  <div style={{ position: "relative" }}>
                    <button
                      className="btn-secondary"
                      onClick={() => _regenerate(true)}
                      onMouseEnter={() => setShowBadTip(true)}
                      onMouseLeave={() => setShowBadTip(false)}
                      onFocus={() => setShowBadTip(true)}
                      onBlur={() => setShowBadTip(false)}
                      style={{ fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--muted)" }}
                    >
                      <X size={13} /> None of these work <Info size={11} />
                    </button>
                    {showBadTip && (
                      <div style={{
                        position: "absolute", right: 0, top: "calc(100% + 6px)",
                        background: "#1C1A14", color: "var(--charcoal)",
                        fontSize: "12px", lineHeight: 1.5, padding: "8px 12px",
                        borderRadius: "6px", width: "220px", zIndex: 10,
                        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                      }}>
                        Marks these as poor matches — improves future suggestions for similar events
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Exhaustion banner — shown when all available combos have been seen */}
              {allSeen && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: "var(--surface)", border: "1px solid var(--border)",
                  borderRadius: "8px", padding: "12px 16px", marginBottom: "20px", gap: "12px",
                }}>
                  <p className="type-helper" style={{ fontSize: "13px", color: "var(--muted)", margin: 0 }}>
                    You&apos;ve seen all look options for this event.
                  </p>
                  <button
                    className="btn-secondary"
                    onClick={handleReset}
                    style={{ fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "5px", whiteSpace: "nowrap" }}
                  >
                    <RefreshCw size={12} /> Reset &amp; start fresh
                  </button>
                </div>
              )}
              {/* Coverage nudge — shown when wardrobe is missing item types for some templates */}
              {coverageHints.length > 0 && (
                <div style={{
                  background: "rgba(212,169,106,0.07)", border: "1px solid rgba(212,169,106,0.22)",
                  borderRadius: "8px", padding: "12px 16px", marginBottom: "20px",
                }}>
                  <p className="type-kicker" style={{ fontSize: "12px", color: "var(--gold)", fontWeight: 600, marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Unlock more looks
                  </p>
                  {coverageHints.map((hint, i) => (
                    <p key={i} className="type-helper" style={{ fontSize: "13px", color: "var(--muted)", margin: "3px 0" }}>
                      ✦ {hint}
                    </p>
                  ))}
                </div>
              )}

              <div className="outfit-carousel">
                {suggestions.map((s, idx) => (
                  <div
                    key={s.id}
                    className="outfit-card-wrap"
                    onMouseEnter={() => setActiveSuggestionId(s.id)}
                    onFocus={() => setActiveSuggestionId(s.id)}
                    tabIndex={0}
                    style={{ outline: "none" }}
                  >
                    <OutfitSuggestionCard
                      suggestion={s}
                      rank={idx + 1}
                      wardrobeMap={wardrobeMap}
                      onRate={(rating) => handleRate(s.id, rating)}
                    />
                  </div>
                ))}
              </div>

              {styleDirection ? (
                <div
                  style={{
                    marginTop: "24px",
                    padding: "20px",
                    borderRadius: "22px",
                    background: "linear-gradient(145deg, rgba(212,169,106,0.10) 0%, rgba(255,255,255,0.04) 100%)",
                    border: "1px solid rgba(212,169,106,0.18)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                    <div>
                      <p className="type-kicker" style={{ margin: 0, fontSize: "11px", color: "var(--gold)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                        Experts suggest
                      </p>
                      <h3 style={{ margin: "8px 0 0", fontFamily: "Playfair Display, serif", fontSize: "clamp(24px, 3vw, 32px)", lineHeight: 1.05, color: "var(--charcoal)" }}>
                        {styleDirection.title}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowExpertSuggestion((value) => !value)}
                      aria-expanded={showExpertSuggestion}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "8px",
                        border: "1px solid rgba(212,169,106,0.18)",
                        background: "rgba(17, 15, 12, 0.42)",
                        color: "var(--charcoal)",
                        borderRadius: "999px",
                        padding: "8px 12px",
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      {showExpertSuggestion ? "Hide" : "Show"}
                      <ChevronDown size={14} style={{ transform: showExpertSuggestion ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.18s ease" }} />
                    </button>
                  </div>

                  {showExpertSuggestion ? (
                    <div style={{ marginTop: "14px" }}>
                      <p style={{ margin: 0, color: "var(--charcoal)", fontSize: "15px", lineHeight: 1.7, fontStyle: "italic" }}>
                        {styleDirection.intro}
                      </p>

                      <div style={{ display: "grid", gap: "10px", marginTop: "18px" }}>
                        {styleDirection.bands.map((band, bandIndex) => (
                          <div key={bandIndex} style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                            {band.items.map((row) => (
                              <span
                                key={row.label}
                                className="type-chip"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "baseline",
                                  gap: "6px",
                                  background: "rgba(17, 15, 12, 0.52)",
                                  color: "#FFF7ED",
                                  border: "1px solid rgba(212,169,106,0.18)",
                                  padding: "12px 14px",
                                  borderRadius: "4px",
                                  width: "fit-content",
                                  maxWidth: "100%",
                                }}
                              >
                                <strong style={{ color: "var(--gold)", whiteSpace: "nowrap" }}>{row.label}:</strong>
                                <span style={{ whiteSpace: "normal" }}>{row.value}</span>
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>

                      <div
                        style={{
                          marginTop: "18px",
                          padding: "14px 16px",
                          borderRadius: "16px",
                          background: "rgba(17, 15, 12, 0.60)",
                          border: "1px solid rgba(212,169,106,0.14)",
                        }}
                      >
                        <p className="type-kicker" style={{ margin: 0, fontSize: "11px", color: "var(--gold)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                          My recommendation
                        </p>
                        <p style={{ margin: "8px 0 0", color: "#FFF7ED", fontSize: "14px", lineHeight: 1.7, fontStyle: "italic" }}>
                          {styleDirection.final}
                        </p>
                        <p style={{ margin: "10px 0 0", color: "rgba(255,247,237,0.76)", fontSize: "13px", lineHeight: 1.6 }}>
                          {styleDirection.avoid}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
