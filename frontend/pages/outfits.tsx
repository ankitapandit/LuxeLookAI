/**
 * pages/outfits.tsx — Outfit suggestions page
 * Shows all events as a history feed with collapsible outfit suggestions.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Navbar from "@/components/layout/Navbar";
import {
  generateOutfits, rateOutfit, getWardrobeItems, getEvents, getSuggestions,
  OutfitSuggestion, ClothingItem, Event,
} from "@/services/api";
import { Sparkles, Info } from "lucide-react";
import toast from "react-hot-toast";

export default function OutfitsPage() {
  const router = useRouter();
  const { eventId } = router.query as { eventId?: string };

  const [events,         setEvents]         = useState<Event[]>([]);
  const [wardrobeMap,    setWardrobeMap]    = useState<Record<string, ClothingItem>>({});
  const [suggestionsMap, setSuggestionsMap] = useState<Record<string, OutfitSuggestion[]>>({});
  const [generatingMap,  setGeneratingMap]  = useState<Record<string, boolean>>({});
  const [collapsedMap,   setCollapsedMap]   = useState<Record<string, boolean>>({});
  const [loadingMsg,     setLoadingMsg]     = useState("Analysing your wardrobe…");
  const [pageLoading,    setPageLoading]    = useState(true);

  const toggleCollapsed = (evId: string) =>
    setCollapsedMap(prev => ({ ...prev, [evId]: !prev[evId] }));

  useEffect(() => { loadPage(); }, []);

  useEffect(() => {
    const isAnyGenerating = Object.values(generatingMap).some(Boolean);
    if (!isAnyGenerating) return;
    const msgs = [
      "Analysing your wardrobe…",
      "Scoring colour combinations…",
      "Checking formality alignment…",
      "Matching styles to your occasion…",
      "Almost there…",
    ];
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % msgs.length;
      setLoadingMsg(msgs[i]);
    }, 2500);
    return () => clearInterval(interval);
  }, [generatingMap]);

  async function loadPage() {
    setPageLoading(true);
    try {
      const [eventsData, items] = await Promise.all([getEvents(), getWardrobeItems()]);
      const map: Record<string, ClothingItem> = {};
      items.forEach(i => { map[i.id] = i; });
      setWardrobeMap(map);
      setEvents(eventsData);

      const suggMap: Record<string, OutfitSuggestion[]> = {};
      await Promise.all(eventsData.map(async (ev) => {
        try { suggMap[ev.id] = await getSuggestions(ev.id); }
        catch { suggMap[ev.id] = []; }
      }));
      setSuggestionsMap(suggMap);

      // Only show events that have suggestions, collapsed by default
      const initCollapsed: Record<string, boolean> = {};
      eventsData
        .filter(ev => (suggMap[ev.id] || []).length > 0)
        .forEach(ev => { initCollapsed[ev.id] = true; });
      setCollapsedMap(initCollapsed);

      if (eventId) {
        setTimeout(() => {
          document.getElementById(`event-${eventId}`)?.scrollIntoView({ behavior: "smooth" });
        }, 300);
      }
    } catch {
      toast.error("Failed to load outfits history");
    } finally {
      setPageLoading(false);
    }
  }

  async function handleGenerate(evId: string) {
    setGeneratingMap(prev => ({ ...prev, [evId]: true }));
    setCollapsedMap(prev => ({ ...prev, [evId]: false }));
    try {
      const [outfitData, items] = await Promise.all([generateOutfits(evId, 5), getWardrobeItems()]);
      const map: Record<string, ClothingItem> = {};
      items.forEach(i => { map[i.id] = i; });
      setWardrobeMap(map);
      setSuggestionsMap(prev => ({ ...prev, [evId]: outfitData.suggestions }));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e?.response?.data?.detail || "Failed to generate outfits");
    } finally {
      setGeneratingMap(prev => ({ ...prev, [evId]: false }));
    }
  }

  async function handleRate(outfitId: string, evId: string, rating: number) {
    try {
      await rateOutfit(outfitId, rating);
      setSuggestionsMap(prev => ({
        ...prev,
        [evId]: (prev[evId] || []).map(s => s.id === outfitId ? { ...s, user_rating: rating } : s),
      }));
      toast.success("Rating saved!");
    } catch {
      toast.error("Could not save rating");
    }
  }

  if (pageLoading) {
    return (
      <>
        <Navbar />
        <div style={{ textAlign: "center", padding: "120px 24px" }}>
          <div style={{
            width: "48px", height: "48px", margin: "0 auto 20px",
            border: "4px solid var(--border)", borderTop: "4px solid var(--gold)",
            borderRadius: "50%", animation: "spin 0.8s linear infinite",
          }} />
          <p style={{ color: "var(--muted)", fontSize: "15px" }}>Loading your outfit history…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </>
    );
  }

  return (
    <>
      <Head><title>Your Outfits — LuxeLook AI</title></Head>
      <Navbar />
      <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "48px 24px" }}>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "40px" }}>
          <Sparkles size={22} color="var(--gold)" />
          <h1 style={{ fontSize: "34px", color: "var(--charcoal)" }}>Your Outfits</h1>
        </div>

        {events.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px", color: "var(--muted)" }}>
            <p style={{ fontSize: "16px" }}>No occasions yet.</p>
            <p style={{ fontSize: "14px", marginTop: "8px" }}>
              Go to <strong>Events</strong> to describe an occasion first.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "48px" }}>
            {events.filter(ev => (suggestionsMap[ev.id] || []).length > 0).map((ev) => {
              const suggestions  = suggestionsMap[ev.id] || [];
              const isGenerating = generatingMap[ev.id]  || false;
              const isCollapsed  = collapsedMap[ev.id]   === true;

              return (
                <div key={ev.id} id={`event-${ev.id}`}>

                  {/* ── Occasion header ── */}
                  <div style={{
                    borderLeft: "3px solid var(--gold)",
                    paddingLeft: "16px",
                    marginBottom: isCollapsed ? "0" : "24px",
                  }}>
                    {/* Date row + collapse button */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <p style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>
                        {new Date(ev.created_at).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                        {" · "}
                        {new Date(ev.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      <button
                        onClick={() => toggleCollapsed(ev.id)}
                        title={isCollapsed ? "Expand" : "Collapse"}
                        style={{
                          background: "none", border: "1px solid var(--border)",
                          borderRadius: "6px", cursor: "pointer",
                          color: "var(--muted)", fontSize: "13px",
                          padding: "4px 10px", marginLeft: "16px",
                          display: "flex", alignItems: "center", gap: "4px",
                          flexShrink: 0,
                        }}
                      >
                        {isCollapsed ? "▸ Show" : "▾ Hide"}
                      </button>
                    </div>
                    {/* Title */}
                    <h2 style={{ fontSize: "20px", fontFamily: "Playfair Display, serif", marginBottom: "8px" }}>
                      {ev.raw_text}
                    </h2>
                    {/* Tags */}
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {[ev.occasion_type, ev.setting, ev.temperature_context].filter(Boolean).map((tag, i) => (
                        <span key={i} style={{ fontSize: "12px", background: "var(--surface)", padding: "3px 10px", borderRadius: "20px", textTransform: "capitalize", color: "var(--ink)" }}>
                          {tag}
                        </span>
                      ))}
                      <span style={{ fontSize: "12px", background: "var(--surface)", padding: "3px 10px", borderRadius: "20px", color: "var(--ink)" }}>
                        {Math.round((ev.formality_level || 0) * 100)}% formality
                      </span>
                    </div>
                  </div>

                  {/* ── Collapsible body ── */}
                  {!isCollapsed && (
                    <>
                      {/* Generating spinner */}
                      {isGenerating && (
                        <div style={{ textAlign: "center", padding: "40px 24px" }}>
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
                          <p style={{ color: "var(--muted)", fontSize: "13px", marginTop: "10px" }}>{loadingMsg}</p>
                          <style>{`
                            @keyframes spin     { to { transform: rotate(360deg); } }
                            @keyframes progress { from { width: 20% } to { width: 85% } }
                          `}</style>
                        </div>
                      )}

                      {/* Suggestions carousel */}
                      {!isGenerating && suggestions.length > 0 && (
                        <div style={{ display: "flex", gap: "20px", overflowX: "auto", paddingBottom: "12px" }}>
                          {suggestions.map((s, idx) => (
                            <div key={s.id} style={{ minWidth: "340px", maxWidth: "380px", flexShrink: 0 }}>
                              <OutfitCard
                                suggestion={s}
                                rank={idx + 1}
                                wardrobeMap={wardrobeMap}
                                onRate={(rating) => handleRate(s.id, ev.id, rating)}
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Empty state + generate button */}
                      {!isGenerating && suggestions.length === 0 && (
                        <div style={{ textAlign: "center", padding: "32px", border: "1px dashed var(--border)", borderRadius: "12px", color: "var(--muted)" }}>
                          <p style={{ marginBottom: "16px", fontSize: "14px" }}>No outfits generated for this occasion yet.</p>
                          <button className="btn-primary" onClick={() => handleGenerate(ev.id)}
                            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            <Sparkles size={15} /> Generate Outfits
                          </button>
                        </div>
                      )}

                      {/* Regenerate button */}
                      {!isGenerating && suggestions.length > 0 && (
                        <div style={{ marginTop: "16px", textAlign: "right" }}>
                          <button className="btn-secondary" onClick={() => handleGenerate(ev.id)}
                            style={{ fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            <Sparkles size={13} /> Regenerate
                          </button>
                        </div>
                      )}
                    </>
                  )}

                </div>
              );
            })}
          </div>
        )}

      </main>
    </>
  );
}

// ── Outfit Card ────────────────────────────────────────────────────────────

function OutfitCard({
  suggestion, rank, wardrobeMap, onRate,
}: {
  suggestion: OutfitSuggestion;
  rank: number;
  wardrobeMap: Record<string, ClothingItem>;
  onRate: (rating: number) => void;
}) {
  const [hover, setHover] = useState(0);
  const allItemIds = [...suggestion.item_ids, ...(suggestion.accessory_ids || [])];
  const items = allItemIds.map((id) => wardrobeMap[id]).filter(Boolean);

  return (
    <div className="card fade-up" style={{ padding: "28px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Look #{rank}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
            <h2 style={{ fontSize: "20px", fontFamily: "Playfair Display, serif" }}>
              {getOutfitTitle(suggestion, wardrobeMap)}
            </h2>
            <span className="score-badge">{Math.round(suggestion.score * 100)}% match</span>
          </div>
        </div>
      </div>

      {/* Item grid */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "24px", overflowX: "auto" }}>
        {items.map((item) => (
          <OutfitItemTile key={item.id} item={item} isAccessory={suggestion.accessory_ids?.includes(item.id)} />
        ))}
        {items.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: "14px" }}>Item images unavailable</p>
        )}
      </div>

      {/* AI explanation */}
      <div style={{ background: "var(--surface)", borderRadius: "8px", padding: "16px", marginBottom: "20px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
        <Info size={16} color="var(--gold)" style={{ flexShrink: 0, marginTop: "2px" }} />
        <p style={{ fontSize: "14px", color: "var(--ink)", lineHeight: 1.6 }}>{suggestion.explanation}</p>
      </div>

      {/* Star rating */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span style={{ fontSize: "13px", color: "var(--muted)" }}>Rate this look:</span>
        <div style={{ display: "flex", gap: "4px" }}>
          {[1, 2, 3, 4, 5].map((star) => (
            <span
              key={star}
              className="star"
              onMouseEnter={() => setHover(star)}
              onMouseLeave={() => setHover(0)}
              onClick={() => onRate(star)}
              style={{ color: star <= (hover || suggestion.user_rating || 0) ? "var(--gold)" : "var(--border)" }}
            >
              ★
            </span>
          ))}
        </div>
        {suggestion.user_rating && (
          <span style={{ fontSize: "13px", color: "var(--muted)" }}>You rated {suggestion.user_rating}/5</span>
        )}
      </div>
    </div>
  );
}

function OutfitItemTile({ item, isAccessory }: { item: ClothingItem; isAccessory?: boolean }) {
  return (
    <div style={{ flexShrink: 0, width: isAccessory ? "100px" : "140px" }}>
      <div style={{
        borderRadius: "8px", overflow: "hidden", background: "var(--surface)",
        aspectRatio: isAccessory ? "1/1" : "3/4",
        border: isAccessory ? "1px dashed var(--border)" : "1px solid var(--border)",
      }}>
        <img
          src={item.image_url}
          alt={item.category}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://via.placeholder.com/200x300/F5F0E8/8A8580?text=${encodeURIComponent(item.category)}`;
          }}
        />
      </div>
      <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px", textAlign: "center", textTransform: "capitalize" }}>
        {isAccessory ? `✦ ${item.accessory_subtype || "accessory"}` : item.category}
      </p>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getOutfitTitle(s: OutfitSuggestion, map: Record<string, ClothingItem>): string {
  const items = s.item_ids.map((id) => map[id]).filter(Boolean);
  if (!items.length) return "Complete Look";
  const colors = Array.from(new Set(items.map((i) => i.color).filter(Boolean)));
  const color  = colors.slice(0, 2).join(" & ");
  return color ? `The ${color} look` : "Complete Look";
}