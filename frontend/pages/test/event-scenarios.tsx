import { useMemo, useState } from "react";
import Head from "next/head";
import Navbar from "@/components/layout/Navbar";
import EventBriefEditor, {
  createDefaultEventBriefValues,
  EventBriefValues,
  serializeEventBrief,
  summarizeEventBrief,
} from "@/components/EventBriefEditor";
import LookAssemblyLoader from "@/components/LookAssemblyLoader";
import OutfitSuggestionCard from "@/components/OutfitSuggestionCard";
import {
  ClothingItem,
  createEvent,
  generateOutfits,
  getWardrobeItems,
  OutfitSuggestion,
  rateOutfit,
  StyleDirectionData,
} from "@/services/api";
import StyleDirectionMoodboard, { getFinishPieces } from "@/components/StyleDirectionMoodboard";
import { EVENT_SCENARIOS } from "@/test/eventScenarios";
import toast from "react-hot-toast";

const INITIAL_SCENARIO = EVENT_SCENARIOS[0];

export default function EventScenarioTestPage() {
  const [brief, setBrief] = useState<EventBriefValues>(INITIAL_SCENARIO?.brief || createDefaultEventBriefValues());
  const [jsonInput, setJsonInput] = useState(
    INITIAL_SCENARIO ? JSON.stringify(serializeEventBrief(INITIAL_SCENARIO.brief), null, 2) : "",
  );
  const [loading, setLoading] = useState(false);
  const [eventId, setEventId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<OutfitSuggestion[]>([]);
  const [styleDirectionData, setStyleDirectionData] = useState<StyleDirectionData | null>(null);
  const [wardrobeMap, setWardrobeMap] = useState<Record<string, ClothingItem>>({});
  const [allSeen, setAllSeen] = useState(false);
  const [coverageHints, setCoverageHints] = useState<string[]>([]);

  const serializedBrief = useMemo(() => JSON.stringify(serializeEventBrief(brief), null, 2), [brief]);

  function resetHarness() {
    setBrief(INITIAL_SCENARIO?.brief || createDefaultEventBriefValues());
    setJsonInput(INITIAL_SCENARIO ? JSON.stringify(serializeEventBrief(INITIAL_SCENARIO.brief), null, 2) : "");
    setEventId(null);
    setSuggestions([]);
    setStyleDirectionData(null);
    setWardrobeMap({});
    setAllSeen(false);
    setCoverageHints([]);
  }

  function loadScenario(id: string) {
    const scenario = EVENT_SCENARIOS.find((entry) => entry.id === id);
    if (!scenario) return;
    setBrief(scenario.brief);
    setJsonInput(JSON.stringify(serializeEventBrief(scenario.brief), null, 2));
    setEventId(null);
    setSuggestions([]);
    setStyleDirectionData(null);
    setAllSeen(false);
    setCoverageHints([]);
  }

  function applyJson() {
    try {
      const parsed = JSON.parse(jsonInput || "{}");
      const next: EventBriefValues = {
        dressCode: Array.isArray(parsed.dressCode) ? parsed.dressCode : [],
        dressCodeOther: String(parsed.dressCodeOther || ""),
        location: String(parsed.location || ""),
        venue: Array.isArray(parsed.venue) ? parsed.venue : [],
        venueOther: String(parsed.venueOther || ""),
        timeOfDay: String(parsed.timeOfDay || ""),
        weather: String(parsed.weather || ""),
        purpose: String(parsed.purpose || (parsed.purposeOther ? "Other" : "")),
        purposeOther: String(parsed.purposeOther || ""),
        styleMood: String(parsed.styleMood || (parsed.styleMoodOther ? "Other" : "")),
        styleMoodOther: String(parsed.styleMoodOther || ""),
        comfortOrFashion: String(parsed.comfortOrFashion || ""),
        duration: String(parsed.duration || (parsed.durationOther ? "Other" : "")),
        durationOther: String(parsed.durationOther || ""),
        audience: String(parsed.audience || (parsed.audienceOther ? "Other" : "")),
        audienceOther: String(parsed.audienceOther || ""),
        notes: String(parsed.notes || ""),
      };
      setBrief(next);
      setEventId(null);
      setSuggestions([]);
      setStyleDirectionData(null);
      setAllSeen(false);
      setCoverageHints([]);
      toast.success("Scenario JSON applied");
    } catch {
      toast.error("Invalid event JSON");
    }
  }

  async function runScenario() {
    setLoading(true);
    setSuggestions([]);
    setStyleDirectionData(null);
    setAllSeen(false);
    setCoverageHints([]);

    try {
      const prompt = summarizeEventBrief(brief, "Event styling request");
      const promptJson = serializeEventBrief(brief);
      const event = await createEvent(prompt, promptJson);
      setEventId(event.id);

      const [outfitData, items] = await Promise.all([
        generateOutfits(event.id, 3),
        getWardrobeItems(),
      ]);

      const map: Record<string, ClothingItem> = {};
      items.forEach((item) => {
        map[item.id] = item;
      });

      setWardrobeMap(map);
      setSuggestions(outfitData.suggestions);
      setAllSeen(outfitData.all_seen ?? false);
      setCoverageHints(outfitData.coverage_hints ?? []);
      setStyleDirectionData(outfitData.style_direction || null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e?.response?.data?.detail || "Could not run scenario");
    } finally {
      setLoading(false);
    }
  }

  async function handleRate(outfitId: string, rating: number) {
    try {
      await rateOutfit(outfitId, rating);
      setSuggestions((prev) => prev.map((suggestion) => (
        suggestion.id === outfitId ? { ...suggestion, user_rating: rating } : suggestion
      )));
      toast.success("Rating saved");
    } catch {
      toast.error("Could not save rating");
    }
  }

  return (
    <>
      <Head><title>Event Scenario Tester — LuxeLook AI</title></Head>
      <Navbar />

      <main className="page-main" style={{ maxWidth: "1180px", margin: "0 auto", padding: "48px 24px" }}>
        <div className="fade-up" style={{ display: "grid", gap: "22px" }}>
          <section
            style={{
              padding: "18px",
              borderRadius: "24px",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              boxShadow: "0 16px 36px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginBottom: "14px" }}>
              <div>
                <p className="type-kicker" style={{ marginBottom: "8px", color: "var(--gold)" }}>
                  Test Harness
                </p>
                <h1 className="type-page-title" style={{ fontSize: "34px", color: "var(--charcoal)", marginBottom: "8px" }}>
                  Event Scenario Tester
                </h1>
                <p className="type-helper" style={{ color: "var(--muted)", maxWidth: "760px" }}>
                  Load saved event cases, tweak them in the shared brief editor, or paste serialized JSON. This page is isolated from the main Event flow.
                </p>
                <p className="type-helper" style={{ color: "var(--muted)", maxWidth: "760px", marginTop: "6px" }}>
                  The first provided scenario is preloaded by default so we can verify the harness quickly.
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={resetHarness}
                style={{ fontSize: "12px", whiteSpace: "nowrap" }}
              >
                Reset tester
              </button>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
              {EVENT_SCENARIOS.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  className="type-chip"
                  onClick={() => loadScenario(scenario.id)}
                  style={{
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#F0EBE2",
                    borderRadius: "999px",
                    padding: "8px 12px",
                    fontSize: "12px",
                  }}
                >
                  {scenario.label}
                </button>
              ))}
            </div>

            <EventBriefEditor values={brief} onChange={setBrief} onReset={resetHarness} mobileCompact />

            <div style={{ display: "grid", gap: "12px", marginTop: "18px" }}>
              <label className="type-helper" style={{ color: "var(--muted)" }}>
                Scenario JSON
              </label>
              <textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                placeholder="Paste serialized event JSON here"
                style={{
                  minHeight: "180px",
                  width: "100%",
                  borderRadius: "16px",
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.04)",
                  color: "#F0EBE2",
                  padding: "14px 16px",
                  fontSize: "13px",
                  lineHeight: 1.55,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                }}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                <button type="button" className="btn-secondary" onClick={applyJson}>
                  Apply JSON
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setJsonInput(serializedBrief);
                    navigator.clipboard.writeText(serializedBrief).catch(() => undefined);
                    toast.success("Current scenario copied");
                  }}
                >
                  Copy current JSON
                </button>
                <button type="button" className="btn-primary" onClick={runScenario} disabled={loading}>
                  {loading ? "Running scenario…" : "Run scenario"}
                </button>
              </div>
            </div>
          </section>

          {loading ? (
            <LookAssemblyLoader
              title="Testing this event"
              subtitle="We’re running the same recommendation path against your selected scenario so you can inspect the outcome quickly."
            />
          ) : null}

          {!loading && (suggestions.length > 0 || styleDirectionData || eventId) ? (
            <section
              style={{
                padding: "18px",
                borderRadius: "24px",
                border: "1px solid var(--border)",
                background: "var(--surface)",
                boxShadow: "0 16px 36px rgba(0,0,0,0.06)",
              }}
            >
              <div style={{ display: "grid", gap: "16px" }}>
                <div>
                  <p className="type-kicker" style={{ marginBottom: "8px", color: "var(--gold)" }}>
                    Scenario output
                  </p>
                  {eventId ? (
                    <p className="type-helper" style={{ color: "var(--muted)" }}>
                      Event ID: <span style={{ color: "#F0EBE2" }}>{eventId}</span>
                    </p>
                  ) : null}
                  {allSeen ? (
                    <p className="type-helper" style={{ color: "var(--muted)" }}>
                      All returned looks have already been seen for this event context.
                    </p>
                  ) : null}
                  {coverageHints.length > 0 ? (
                    <div style={{ marginTop: "8px", display: "grid", gap: "4px" }}>
                      {coverageHints.map((hint, index) => (
                        <p key={index} className="type-helper" style={{ color: "var(--muted)", margin: 0 }}>
                          ✦ {hint}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>

                {suggestions.length > 0 ? (
                  <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
                    {suggestions.map((suggestion, index) => (
                      <OutfitSuggestionCard
                        key={suggestion.id}
                        suggestion={suggestion}
                        rank={index + 1}
                        wardrobeMap={wardrobeMap}
                        onRate={(rating) => handleRate(suggestion.id, rating)}
                      />
                    ))}
                  </div>
                ) : null}

                {styleDirectionData?.options?.length ? (
                  <div style={{ display: "grid", gap: "12px" }}>
                    <h2 className="type-section-title" style={{ fontSize: "22px", color: "var(--charcoal)" }}>
                      Beyond your wardrobe
                    </h2>
                    <div style={{ display: "grid", gap: "20px", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
                      {styleDirectionData.options.map((option, index) => (
                        <div
                          key={`${option.name}-${index}`}
                          style={{
                            borderRadius: "18px",
                            background: "rgba(17, 15, 12, 0.50)",
                            border: "1px solid rgba(212,169,106,0.14)",
                            padding: "16px",
                            display: "grid",
                            gap: "0px",
                          }}
                        >
                          {/* Option header */}
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                            <span style={{ fontSize: "22px", lineHeight: 1 }}>{option.emoji}</span>
                            <h4 style={{ margin: 0, fontFamily: "Playfair Display, serif", fontSize: "18px", color: "#FFF7ED", lineHeight: 1.15 }}>
                              {option.name}
                            </h4>
                          </div>

                          {/* Visual moodboard */}
                          <StyleDirectionMoodboard option={option} />

                          {/* Finishing notes (Hair, Makeup, etc.) */}
                          {(() => {
                            const finishPieces = getFinishPieces(option.pieces);
                            if (!finishPieces.length) return null;
                            return (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px" }}>
                                {finishPieces.map((piece) => (
                                  <span
                                    key={piece.label}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "baseline",
                                      gap: "5px",
                                      background: "rgba(255,255,255,0.04)",
                                      color: "#FFF7ED",
                                      border: "1px solid rgba(212,169,106,0.13)",
                                      padding: "6px 10px",
                                      borderRadius: "6px",
                                      fontSize: "12px",
                                    }}
                                  >
                                    <strong style={{ color: "var(--gold)", whiteSpace: "nowrap", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                      {piece.label}
                                    </strong>
                                    <span style={{ whiteSpace: "normal" }}>{piece.value}</span>
                                  </span>
                                ))}
                              </div>
                            );
                          })()}

                          {/* Why it works */}
                          <p style={{ margin: "12px 0 0", color: "rgba(255,247,237,0.88)", fontSize: "13px", lineHeight: 1.65, fontStyle: "italic" }}>
                            <strong style={{ color: "var(--gold)", fontStyle: "normal", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.10em", marginRight: "6px" }}>Why it works</strong>
                            {option.why}
                          </p>

                          {/* Tip */}
                          {option.tip ? (
                            <p style={{ margin: "8px 0 0", color: "rgba(255,247,237,0.60)", fontSize: "12px", lineHeight: 1.6 }}>
                              <strong style={{ color: "rgba(212,169,106,0.75)", fontStyle: "normal", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.10em", marginRight: "6px" }}>Tip</strong>
                              {option.tip}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </>
  );
}
