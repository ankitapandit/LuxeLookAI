/**
 * pages/events.tsx — Occasion input page
 * User describes an event in natural language; AI parses it.
 * On success, redirects to /outfits with the generated suggestions.
 */

import { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Navbar from "@/components/layout/Navbar";
import { createEvent, generateOutfits } from "@/services/api";
import { CalendarDays, Sparkles, ArrowRight } from "lucide-react";
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
  const router       = useRouter();
  const [text, setText]     = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep]       = useState<"input" | "parsed">("input");
  const [parsedEvent, setParsedEvent] = useState<any>(null);

  async function handleCreateEvent() {
    if (!text.trim()) return;
    setLoading(true);

    try {
      // Step 1: Create event (LLM parses the occasion)
      const event = await createEvent(text);
      setParsedEvent(event);
      setStep("parsed");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Could not parse occasion");
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateOutfits() {
    if (!parsedEvent) return;
    setLoading(true);

    try {
      // Step 2: Generate outfits for the parsed event
      const result = await generateOutfits(parsedEvent.id, 3);
      // Pass data to outfits page via router state
      router.push({
        pathname: "/outfits",
        // query: { eventId: parsedEvent.id },
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Could not generate outfits");
      setLoading(false);
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
              What's the occasion?
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
            onChange={(e) => { setText(e.target.value); setStep("input"); setParsedEvent(null); }}
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
                  onClick={() => { setText(ex); setStep("input"); setParsedEvent(null); }}
                  style={{
                    background: "white",
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
            onClick={handleCreateEvent}
            disabled={!text.trim() || loading}
            style={{ width: "100%" }}
          >
            {loading && step === "input" ? "Parsing with AI…" : "Parse Occasion"}
          </button>

          {/* ── Parsed event card ──────────────────────────────────────── */}
          {step === "parsed" && parsedEvent && (
            <div
              className="card fade-up"
              style={{ marginTop: "32px", padding: "24px" }}
            >
              <p style={{ fontSize: "12px", color: "var(--gold)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "16px" }}>
                ✓ Occasion parsed
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
                <InfoRow label="Occasion type" value={parsedEvent.occasion_type} />
                <InfoRow label="Formality" value={`${Math.round(parsedEvent.formality_level * 100)}%`} />
                <InfoRow label="Setting" value={parsedEvent.setting || "—"} />
                <InfoRow label="Temperature" value={parsedEvent.temperature_context || "—"} />
              </div>

              <button
                className="btn-gold"
                onClick={handleGenerateOutfits}
                disabled={loading}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
              >
                <Sparkles size={16} />
                {loading ? "Generating outfits…" : "Generate My Outfits"}
                {!loading && <ArrowRight size={16} />}
              </button>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>
        {label}
      </p>
      <p style={{ fontWeight: 500, color: "var(--charcoal)", textTransform: "capitalize" }}>
        {value}
      </p>
    </div>
  );
}
