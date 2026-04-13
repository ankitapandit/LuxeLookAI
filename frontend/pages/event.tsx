/**
 * pages/event.tsx — Event input page
 * User describes an event in natural language; AI parses it.
 * On success, generates looks for the current event.
 */

import type React from "react";
import { useState } from "react";
import Head from "next/head";
import Navbar from "@/components/layout/Navbar";
import { createEvent, generateOutfits, resetFeedback, getWardrobeItems, rateOutfit, OutfitSuggestion, ClothingItem, StyleDirectionData } from "@/services/api";
import OutfitSuggestionCard from "@/components/OutfitSuggestionCard";
import EventBriefEditor, { createDefaultEventBriefValues, EventBriefValues, serializeEventBrief, summarizeEventBrief } from "@/components/EventBriefEditor";
import LookAssemblyLoader from "@/components/LookAssemblyLoader";
import { CalendarDays, ChevronDown, Sparkles, Info, X, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";

export default function EventsPage() {
  const [brief,          setBrief]          = useState<EventBriefValues>(createDefaultEventBriefValues());
  const [loading,        setLoading]        = useState(false);
  const [eventId,        setEventId]        = useState<string | null>(null);
  const [suggestions,    setSuggestions]    = useState<OutfitSuggestion[]>([]);
  const [styleDirectionData, setStyleDirectionData] = useState<StyleDirectionData | null>(null);
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

  async function handleGenerate() {
    setLoading(true);
    setSuggestions([]);
    setAllShownIds([]);
    setAllSeen(false);
    setStyleDirectionData(null);
    try {
      const prompt = summarizeEventBrief(brief, "Event styling request");
      const promptJson = serializeEventBrief(brief);
      console.info("[Event] generate looks clicked", {
        brief,
        promptPreview: prompt.slice(0, 220),
      });
      const event = await createEvent(prompt, promptJson);
      console.info("[Event] event created", { eventId: event.id });
      setEventId(event.id);
      const [outfitData, items] = await Promise.all([
        generateOutfits(event.id, 5),
        getWardrobeItems(),
      ]);
      console.info("[Event] generate outfits response", {
        eventId: event.id,
        suggestionCount: outfitData.suggestions.length,
        allSeen: outfitData.all_seen ?? false,
        coverageHints: outfitData.coverage_hints ?? [],
      });
      const map: Record<string, ClothingItem> = {};
      items.forEach(i => { map[i.id] = i; });
      setWardrobeMap(map);
      setSuggestions(outfitData.suggestions);
      const newIds = outfitData.suggestions.map(s => s.id);
      setAllShownIds(newIds);
      setAllSeen(outfitData.all_seen ?? false);
      setCoverageHints(outfitData.coverage_hints ?? []);
      setStyleDirectionData(outfitData.style_direction || null);
    } catch (err: unknown) {
      console.error("[Event] generate looks failed", err);
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
      setStyleDirectionData(outfitData.style_direction || null);
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
      setStyleDirectionData(null);
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

      <main className="page-main" style={{ maxWidth: "1100px", margin: "0 auto", padding: "48px 24px" }}>
        <div className="fade-up">
          <div style={{ marginBottom: "40px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <CalendarDays size={24} color="var(--gold)" />
              <h1 className="type-page-title" style={{ fontSize: "36px", color: "var(--charcoal)" }}>
                Describe your event
              </h1>
            </div>

            <div
              style={{
                padding: "18px",
                borderRadius: "24px",
                border: "1px solid var(--border)",
                background: "var(--surface)",
                boxShadow: "0 16px 36px rgba(0,0,0,0.06)",
              }}
            >
              <EventBriefEditor values={brief} onChange={setBrief} mobileCompact />
            </div>

            <button
              className="btn-primary"
              onClick={handleGenerate}
              disabled={loading}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginTop: "14px" }}
            >
              <Sparkles size={16} />
              {loading ? "Generating looks…" : "Generate Looks"}
            </button>
          </div>

          {/* ── Generating loader ── */}
          {loading && (
            <div style={{ paddingTop: "28px" }}>
              <LookAssemblyLoader
                title="Building your looks"
                subtitle="We’re pairing pieces from your wardrobe into event-ready outfits and tightening the strongest combinations first."
              />
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

              {styleDirectionData && styleDirectionData.options.length > 0 ? (
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
                      <h3 style={{ margin: "8px 0 0", fontFamily: "Playfair Display, serif", fontSize: "clamp(22px, 3vw, 30px)", lineHeight: 1.05, color: "var(--charcoal)" }}>
                        {styleDirectionData.options.length === 1 ? "One direction worth trying" : `${styleDirectionData.options.length} ways to style this`}
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
                    <div style={{ display: "grid", gap: "16px", marginTop: "18px" }}>
                      {styleDirectionData.options.map((option, optIndex) => (
                        <div
                          key={optIndex}
                          style={{
                            borderRadius: "18px",
                            background: "rgba(17, 15, 12, 0.50)",
                            border: "1px solid rgba(212,169,106,0.14)",
                            padding: "18px",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                            <span style={{ fontSize: "22px", lineHeight: 1 }}>{option.emoji}</span>
                            <h4 style={{ margin: 0, fontFamily: "Playfair Display, serif", fontSize: "18px", color: "#FFF7ED", lineHeight: 1.15 }}>
                              {option.name}
                            </h4>
                          </div>

                          {(() => {
                          const garmentOrder = ["top", "base", "dress", "bottom", "shoes", "footwear"];
                          const accessoryOrder = ["accessories", "accessory", "bag", "jewelry", "outerwear"];
                          const finishOrder = ["hair", "makeup"];

                          const classify = (label: string) => {
                            const l = label.toLowerCase();
                            if (finishOrder.includes(l)) return "finish";
                            if (accessoryOrder.includes(l)) return "accessory";
                            return "garment";
                          };

                          const sortByOrder = (pieces: typeof option.pieces, order: string[]) =>
                            [...pieces].sort((a, b) => {
                              const aIndex = order.indexOf(a.label.toLowerCase());
                              const bIndex = order.indexOf(b.label.toLowerCase());
                              const safeA = aIndex === -1 ? order.length : aIndex;
                              const safeB = bIndex === -1 ? order.length : bIndex;
                              return safeA - safeB;
                            });

                          const garmentRow = sortByOrder(option.pieces.filter((p) => classify(p.label) === "garment"), garmentOrder);
                          const accessoryRow = sortByOrder(option.pieces.filter((p) => classify(p.label) === "accessory"), accessoryOrder);
                          const finishRow = sortByOrder(option.pieces.filter((p) => classify(p.label) === "finish"), finishOrder);

                          const chipStyle: React.CSSProperties = {
                            display: "inline-flex",
                            alignItems: "baseline",
                            gap: "5px",
                            background: "rgba(255,255,255,0.05)",
                            color: "#FFF7ED",
                            border: "1px solid rgba(212,169,106,0.16)",
                            padding: "8px 12px",
                            borderRadius: "6px",
                            fontSize: "13px",
                          };
                          const labelStyle: React.CSSProperties = {
                            color: "var(--gold)",
                            whiteSpace: "nowrap",
                            fontSize: "11px",
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                          };

                          const renderRow = (pieces: typeof option.pieces) =>
                            pieces.length > 0 ? (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                {pieces.map((piece) => (
                                  <span key={piece.label} className="type-chip" style={chipStyle}>
                                    <strong style={labelStyle}>{piece.label}</strong>
                                    <span style={{ whiteSpace: "normal" }}>{piece.value}</span>
                                  </span>
                                ))}
                              </div>
                            ) : null;

                          return (
                            <div style={{ display: "grid", gap: "8px", marginBottom: "14px" }}>
                              {renderRow(garmentRow)}
                              {renderRow(accessoryRow)}
                              {renderRow(finishRow)}
                            </div>
                          );
                        })()}

                        <p style={{ margin: 0, color: "rgba(255,247,237,0.88)", fontSize: "13px", lineHeight: 1.65, fontStyle: "italic" }}>
                          <strong style={{ color: "var(--gold)", fontStyle: "normal", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.10em", marginRight: "6px" }}>Why it works</strong>
                          {option.why}
                        </p>

                          {option.tip ? (
                            <p style={{ margin: "8px 0 0", color: "rgba(255,247,237,0.60)", fontSize: "12px", lineHeight: 1.6 }}>
                              <strong style={{ color: "rgba(212,169,106,0.75)", fontStyle: "normal", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.10em", marginRight: "6px" }}>Tip</strong>
                              {option.tip}
                            </p>
                          ) : null}
                        </div>
                      ))}
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
