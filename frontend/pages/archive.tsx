/**
 * pages/archive.tsx — Archive page
 * Shows all events as a history feed with collapsible saved looks.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import {
  generateOutfits, rateOutfit, getWardrobeItems, getEvents, getSuggestions,
  OutfitSuggestion, ClothingItem, Event,
} from "@/services/api";
import OutfitSuggestionCard from "@/components/OutfitSuggestionCard";
import { Sparkles } from "lucide-react";
import toast from "react-hot-toast";

function getSuggestionComboKey(suggestion: OutfitSuggestion): string {
  return [
    ...(suggestion.item_ids || []),
    ...(suggestion.accessory_ids || []),
  ]
    .map(String)
    .sort()
    .join("|");
}

function mergeSuggestionsRecentFirst(
  fresh: OutfitSuggestion[],
  existing: OutfitSuggestion[],
): OutfitSuggestion[] {
  const merged: OutfitSuggestion[] = [];
  const seen = new Set<string>();

  for (const suggestion of [...fresh, ...existing]) {
    const comboKey = getSuggestionComboKey(suggestion);
    const fallbackKey = suggestion.id;
    const key = comboKey || fallbackKey;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(suggestion);
  }

  return merged;
}

function summarizeArchiveEvent(rawText: string, rawTextJson?: Record<string, unknown> | null): string {
  const structured = rawTextJson || {};
  if (Object.keys(structured).length > 0) {
    const collectValues = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        return value.map((entry) => String(entry).trim()).filter(Boolean);
      }
      const text = String(value || "").trim();
      return text ? [text] : [];
    };

    const joinSlash = (...values: unknown[]): string =>
      values
        .flatMap((value) => collectValues(value))
        .filter(Boolean)
        .join(" / ");

    const lowerText = (value: string): string => value.toLowerCase();

    const normalizeLocation = (value: unknown): string => {
      const location = collectValues(value)[0] || "";
      if (!location) return "";
      if (location.toLowerCase() === "both") return "indoor/outdoor";
      return location.toLowerCase();
    };

    const comfortPhrase = (value: unknown): string => {
      const raw = (collectValues(value)[0] || "").toLowerCase();
      if (raw === "comfort") return "comfortable";
      if (raw === "fashion") return "fashionable";
      if (raw === "balanced") return "fashionably comfortable";
      return "";
    };

    const dressCode = lowerText(joinSlash(structured.dressCode, structured.dressCodeOther));
    const venue = lowerText(joinSlash(structured.venue, structured.venueOther));
    const timeOfDay = lowerText(collectValues(structured.timeOfDay)[0] || "");
    const weather = lowerText(collectValues(structured.weather)[0] || "");
    const location = normalizeLocation(structured.location);
    const comfort = comfortPhrase(structured.comfortOrFashion);
    const purpose = lowerText(joinSlash(structured.purpose, structured.purposeOther));
    const audience = lowerText(collectValues(structured.audience)[0] || "");
    const duration = lowerText(collectValues(structured.duration)[0] || "");
    const styleMood = lowerText(joinSlash(structured.styleMood, structured.styleMoodOther));
    const notes = collectValues(structured.notes)[0] || "";

    const openingSegments = [
      venue ? `for ${venue}` : "",
      purpose ? `for ${purpose}` : "",
      timeOfDay ? `during ${timeOfDay}` : "",
      weather ? `with ${weather} weather` : "",
      location || comfort
        ? `with ${[
            location ? `${location}` : "",
            comfort ? `${comfort}` : "",
          ].filter(Boolean).join(", ")} approach`
        : "",
    ].filter(Boolean);

    const followupSegments = [
      audience ? `with ${audience}` : "",
      duration ? `for about ${duration}` : "",
      styleMood ? `keep the look ${styleMood}` : "",
    ].filter(Boolean);

    const sentenceSegments: string[] = [];
    if (openingSegments.length > 0) {
      const openingPrefix = dressCode ? `${dressCode} outfit` : "Outfit";
      const opening = `${openingPrefix} ${openingSegments.join(" ")}`.replace(/\s+/g, " ").trim();
      sentenceSegments.push(opening);
    }

    if (followupSegments.length > 0) {
      sentenceSegments.push(followupSegments.join(", ").replace(/\s+/g, " ").trim());
    }

    if (notes) {
      sentenceSegments.push(`.On a side note: ${notes}`);
    }

    if (sentenceSegments.length > 0) {
      const sentence = sentenceSegments.join(", ").replace(/\s+/g, " ").trim();
      return sentence.charAt(0).toUpperCase() + sentence.slice(1);
    }
  }

  const text = (rawText || "").trim();
  return text || "Event styling request";
}

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
  const visibleEvents = events.filter((ev) => (suggestionsMap[ev.id] || []).length > 0);

  const toggleCollapsed = (evId: string) =>
    setCollapsedMap(prev => ({ ...prev, [evId]: !prev[evId] }));

  const loadPage = useCallback(async () => {
    setPageLoading(true);
    try {
      const loadBaseData = async () => Promise.all([getEvents(), getWardrobeItems()]);
      let eventsData: Event[] = [];
      let items: ClothingItem[] = [];
      try {
        [eventsData, items] = await loadBaseData();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
        [eventsData, items] = await loadBaseData();
      }
      const map: Record<string, ClothingItem> = {};
      items.forEach(i => { map[i.id] = i; });
      setWardrobeMap(map);
      setEvents(eventsData);

      const suggMap: Record<string, OutfitSuggestion[]> = {};
      await Promise.all(eventsData.map(async (ev) => {
        try { suggMap[ev.id] = await getSuggestions(ev.id); }
        catch { suggMap[ev.id] = []; }
      }));

      // Auto-regenerate suggestions that have no card OR have an outdated card schema
      // (pre-v2.0 cards used trend_meter + array vibe + color_story — detect by absence of trend_stars).
      await Promise.all(eventsData.map(async (ev) => {
        const existing = suggMap[ev.id] || [];
        const isOutdated = (s: OutfitSuggestion) =>
          !s.card || !("trend_stars" in s.card) || typeof s.card.trend_stars !== "number";
        const needsUpgrade = existing.length > 0 && existing.every(isOutdated);
        if (!needsUpgrade) return;
        try {
          const fresh = await generateOutfits(ev.id, 3);
          suggMap[ev.id] = fresh.suggestions;
        } catch {
          // Upgrade failed silently — old suggestions kept, card section hidden
        }
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
      if (events.length === 0) {
        toast.error("Failed to load archive");
      }
    } finally {
      setPageLoading(false);
    }
  }, [eventId, events.length]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);
  useEffect(() => {
    const isAnyGenerating = Object.values(generatingMap).some(Boolean);
    if (!isAnyGenerating) return;
    const msgs = [
      "Analysing your wardrobe…",
      "Scoring colour combinations…",
      "Checking formality alignment…",
      "Matching styles to your event…",
      "Almost there…",
    ];
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % msgs.length;
      setLoadingMsg(msgs[i]);
    }, 2500);
    return () => clearInterval(interval);
  }, [generatingMap]);

  async function handleGenerate(evId: string) {
    setGeneratingMap(prev => ({ ...prev, [evId]: true }));
    setCollapsedMap(prev => ({ ...prev, [evId]: false }));
    try {
      const [outfitData, items] = await Promise.all([generateOutfits(evId, 3), getWardrobeItems()]);
      const map: Record<string, ClothingItem> = {};
      items.forEach(i => { map[i.id] = i; });
      setWardrobeMap(map);
      setSuggestionsMap(prev => ({
        ...prev,
        [evId]: mergeSuggestionsRecentFirst(outfitData.suggestions, prev[evId] || []),
      }));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e?.response?.data?.detail || "Failed to generate looks");
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
          <p style={{ color: "var(--muted)", fontSize: "15px" }}>Loading your archive…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </>
    );
  }

  return (
    <>
      <Head><title>Archive — LuxeLook AI</title></Head>
      <Navbar />
      <main className="page-main" style={{ maxWidth: "1100px", margin: "0 auto", padding: "48px 24px" }}>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "40px" }}>
          <Sparkles size={22} color="var(--gold)" />
          <h1 className="type-page-title" style={{ fontSize: "34px", color: "var(--charcoal)" }}>Archive</h1>
        </div>

        {events.length === 0 || visibleEvents.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "92px 28px",
              color: "var(--muted)",
              borderRadius: "28px",
              border: "1px solid var(--border)",
              background: "linear-gradient(180deg, rgba(33,27,22,0.92), rgba(18,14,11,0.98))",
            }}
          >
            <p className="type-kicker" style={{ margin: 0, fontSize: "11px", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,247,237,0.56)" }}>
              Archive
            </p>
            <h2 style={{ margin: "10px 0 0", fontFamily: "Playfair Display, serif", fontSize: "32px", color: "#FFF7ED" }}>
              No looks saved yet
            </h2>
            <p className="type-body" style={{ fontSize: "16px", marginTop: "12px", color: "rgba(255,247,237,0.72)", lineHeight: 1.65 }}>
              Generate your first outfit inspo at <strong>Style Item</strong> or from the <strong>Event</strong> page.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: "10px", flexWrap: "wrap", marginTop: "22px" }}>
              <Link href="/style-item" style={{ textDecoration: "none" }}>
                <span className="btn-primary">Style Item</span>
              </Link>
              <Link href="/event" style={{ textDecoration: "none" }}>
                <span className="btn-secondary">Event</span>
              </Link>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "48px" }}>
            {visibleEvents.map((ev) => {
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
                      <p className="type-micro" style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>
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
                    <h2 className="type-section-title" style={{ fontSize: "20px", fontFamily: "Playfair Display, serif", marginBottom: "8px" }}>
                      {summarizeArchiveEvent(ev.raw_text, ev.raw_text_json)}
                    </h2>
                    {/* Tags */}
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {[ev.occasion_type, ev.setting, ev.temperature_context].filter(Boolean).map((tag, i) => (
                        <span key={i} className="type-chip" style={{ fontSize: "12px", background: "var(--surface)", padding: "3px 10px", borderRadius: "20px", textTransform: "capitalize", color: "var(--ink)" }}>
                          {tag}
                        </span>
                      ))}
                      <span className="type-chip" style={{ fontSize: "12px", background: "var(--surface)", padding: "3px 10px", borderRadius: "20px", color: "var(--ink)" }}>
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
                            Building your looks…
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
                        <div className="outfit-carousel">
                          {suggestions.map((s, idx) => (
                            <div key={s.id} className="outfit-card-wrap">
                              <OutfitSuggestionCard
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
                          <p className="type-body" style={{ marginBottom: "16px", fontSize: "14px" }}>No looks saved for this event yet.</p>
                          <button className="btn-primary" onClick={() => handleGenerate(ev.id)}
                            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            <Sparkles size={15} /> Generate Looks
                          </button>
                        </div>
                      )}

                      {/* Regenerate button */}
                      {!isGenerating && suggestions.length > 0 && (
                        <div style={{ marginTop: "16px", textAlign: "right" }}>
                          <button className="btn-secondary" onClick={() => handleGenerate(ev.id)}
                            style={{ fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            <Sparkles size={13} /> Refresh Looks
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
