/**
 * pages/events.tsx — Occasion input page
 * User describes an event in natural language; AI parses it.
 * On success, redirects to /outfits with the generated suggestions.
 */

import { useState } from "react";
// import { useRouter } from "next/router";
import Head from "next/head";
import Navbar from "@/components/layout/Navbar";
import { createEvent, generateOutfits, resetFeedback, getWardrobeItems, rateOutfit, OutfitSuggestion, ClothingItem } from "@/services/api";
import OutfitMetricCard, { isCurrentCardSchema } from "@/components/OutfitCard";
import { CalendarDays, Sparkles, Info, X, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";

// Example prompts to inspire the user
const EXAMPLES = [
  "Black-tie gala at the art museum on Saturday evening",
  "Casual brunch with friends on Sunday morning",
  "Job interview at a tech startup this Tuesday",
  "Outdoor birthday party at the park, warm afternoon",
  "First date at a cozy wine bar, smart casual",
];

export default function EventsPage() {
  const [text,           setText]           = useState("");
  const [loading,        setLoading]        = useState(false);
  const [eventId,        setEventId]        = useState<string | null>(null);
  const [suggestions,    setSuggestions]    = useState<OutfitSuggestion[]>([]);
  const [wardrobeMap,    setWardrobeMap]    = useState<Record<string, ClothingItem>>({});
  const [hover,          setHover]          = useState<Record<string, number>>({});
  // Accumulated suggestion IDs shown across all regenerates this session
  const [allShownIds,    setAllShownIds]    = useState<string[]>([]);
  // True when every returned outfit was previously seen (wardrobe variety exhausted)
  const [allSeen,         setAllSeen]         = useState(false);
  // Plain-English hints about missing item types that would unlock more templates
  const [coverageHints,   setCoverageHints]   = useState<string[]>([]);
  // Controls visibility of the "None of these work" tooltip
  const [showBadTip,      setShowBadTip]      = useState(false);

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
      toast.error(e?.response?.data?.detail || "Could not generate outfit suggestions");
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
      toast.error(e?.response?.data?.detail || "Could not regenerate outfits");
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
      toast.success("Feedback reset — generating fresh suggestions…");
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
      <Head><title>Plan an Outfit — LuxeLook AI</title></Head>
      <Navbar />

      <main style={{ maxWidth: "680px", margin: "0 auto", padding: "64px 24px" }}>
        <div className="fade-up">
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <CalendarDays size={24} color="var(--gold)" />
            <h1 style={{ fontSize: "36px", color: "var(--charcoal)" }}>
              What&apos;s the occasion?
            </h1>
          </div>
          <p style={{ color: "var(--muted)", fontSize: "16px", marginBottom: "40px" }}>
            Describe your event in plain English. Our AI will parse the context
            and build the perfect outfit from your wardrobe.
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
            <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
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
            {loading ? "Generating outfit suggestions…" : "Generate Outfit Suggestions"}
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
                Building your perfect outfits…
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
                <h2 style={{ fontSize: "22px", fontFamily: "Playfair Display, serif", color: "var(--charcoal)" }}>
                  Your Looks
                </h2>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {/* Neutral regenerate — no ratings written */}
                  <button
                    className="btn-secondary"
                    onClick={() => _regenerate(false)}
                    style={{ fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <Sparkles size={13} /> Show me more
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
                        Marks these as poor matches — improves future suggestions for similar occasions
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
                  <p style={{ fontSize: "13px", color: "var(--muted)", margin: 0 }}>
                    You&apos;ve seen all outfit options for this occasion.
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
                  <p style={{ fontSize: "12px", color: "var(--gold)", fontWeight: 600, marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Unlock more looks
                  </p>
                  {coverageHints.map((hint, i) => (
                    <p key={i} style={{ fontSize: "13px", color: "var(--muted)", margin: "3px 0" }}>
                      ✦ {hint}
                    </p>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: "20px", overflowX: "auto", paddingBottom: "12px" }}>
                {suggestions.map((s, idx) => (
                  <div key={s.id} style={{ minWidth: "340px", maxWidth: "380px", flexShrink: 0 }}>
                    <div className="card fade-up" style={{ padding: "24px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
                        <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Look #{idx + 1}</span>
                        <span className="score-badge">{Math.round(s.score * 100)}% match</span>
                      </div>
                      <div style={{ display: "flex", gap: "12px", marginBottom: "20px", overflowX: "auto" }}>
                        {[...s.item_ids, ...(s.accessory_ids || [])].map(id => wardrobeMap[id]).filter(Boolean).map(item => (
                          <div key={item.id} style={{ flexShrink: 0, width: s.accessory_ids?.includes(item.id) ? "90px" : "130px" }}>
                            <div style={{ borderRadius: "8px", overflow: "hidden", background: "var(--surface)", aspectRatio: s.accessory_ids?.includes(item.id) ? "1/1" : "3/4", border: "1px solid var(--border)" }}>
                              <img src={item.image_url} alt={item.category}
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                onError={e => { (e.target as HTMLImageElement).src = `https://via.placeholder.com/200x300/F5F0E8/8A8580?text=${encodeURIComponent(item.category)}`; }}
                              />
                            </div>
                            <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px", textAlign: "center", textTransform: "capitalize" }}>{item.category}</p>
                          </div>
                      ))}
                    </div>
                    </div>
                    {isCurrentCardSchema(s.card)
                      ? <div style={{ marginBottom: "16px" }}><OutfitMetricCard card={s.card} /></div>
                      : null
                    }
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "13px", color: "var(--muted)" }}>Rate this look:</span>
                      <div style={{ display: "flex", gap: "4px" }}>
                        {[1,2,3,4,5].map(star => (
                          <span key={star}
                            onMouseEnter={() => setHover(prev => ({ ...prev, [s.id]: star }))}
                            onMouseLeave={() => setHover(prev => ({ ...prev, [s.id]: 0 }))}
                            onClick={() => handleRate(s.id, star)}
                            style={{ cursor: "pointer", fontSize: "20px", color: star <= (hover[s.id] || s.user_rating || 0) ? "var(--gold)" : "var(--border)" }}
                          >★</span>
                        ))}
                      </div>
                      {s.user_rating && <span style={{ fontSize: "13px", color: "var(--muted)" }}>You rated {s.user_rating}/5</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

