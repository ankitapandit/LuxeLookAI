/**
 * pages/outfits.tsx — Outfit suggestions page
 * Displays generated outfit recommendations with scoring and star ratings.
 * Fetches suggestions for the eventId passed via query params.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Navbar from "@/components/layout/Navbar";
import { generateOutfits, rateOutfit, getWardrobeItems, OutfitSuggestion, ClothingItem, Event } from "@/services/api";
import { Sparkles, Star, Info } from "lucide-react";
import toast from "react-hot-toast";

export default function OutfitsPage() {
  const router = useRouter();
  const { eventId } = router.query as { eventId?: string };

  const [suggestions, setSuggestions] = useState<OutfitSuggestion[]>([]);
  const [event,       setEvent]       = useState<Event | null>(null);
  const [wardrobeMap, setWardrobeMap] = useState<Record<string, ClothingItem>>({});
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    if (!eventId) return;
    loadData(eventId);
  }, [eventId]);

  async function loadData(evId: string) {
    setLoading(true);
    try {
      // Fetch outfits and wardrobe in parallel
      const [outfitData, items] = await Promise.all([
        generateOutfits(evId, 3),
        getWardrobeItems(),
      ]);
      setEvent(outfitData.event);
      setSuggestions(outfitData.suggestions);

      // Build an id→item map for fast lookup when rendering outfit items
      const map: Record<string, ClothingItem> = {};
      items.forEach((i) => { map[i.id] = i; });
      setWardrobeMap(map);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to load outfits");
    } finally {
      setLoading(false);
    }
  }

  async function handleRate(outfitId: string, rating: number) {
    try {
      await rateOutfit(outfitId, rating);
      setSuggestions((prev) =>
        prev.map((s) => (s.id === outfitId ? { ...s, user_rating: rating } : s))
      );
      toast.success("Rating saved!");
    } catch {
      toast.error("Could not save rating");
    }
  }

  if (loading) {
    return (
      <>
        <Navbar />
        <div style={{ textAlign: "center", padding: "120px 24px" }}>
          <Sparkles size={40} color="var(--gold)" style={{ margin: "0 auto 16px", display: "block", animation: "pulse 1.5s ease-in-out infinite" }} />
          <p style={{ color: "var(--muted)", fontSize: "16px" }}>Building your perfect outfits…</p>
          <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
        </div>
      </>
    );
  }

  return (
    <>
      <Head><title>Your Outfits — LuxeLook AI</title></Head>
      <Navbar />

      <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "48px 24px" }}>
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: "40px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
            <Sparkles size={22} color="var(--gold)" />
            <h1 style={{ fontSize: "34px", color: "var(--charcoal)" }}>
              Your Outfits
            </h1>
          </div>
          {event && (
            <p style={{ color: "var(--muted)", fontSize: "15px" }}>
              Styled for: <strong style={{ color: "var(--ink)", textTransform: "capitalize" }}>{event.occasion_type}</strong>
              {event.setting ? ` · ${event.setting}` : ""}
              {" · "}<em style={{ fontSize: "14px" }}>{event.raw_text}</em>
            </p>
          )}
        </div>

        {/* ── Suggestion cards ────────────────────────────────────────── */}
        {suggestions.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px", color: "var(--muted)" }}>
            <p style={{ fontSize: "16px" }}>No outfits could be generated.</p>
            <p style={{ fontSize: "14px", marginTop: "8px" }}>
              Try adding more items to your wardrobe.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
            {suggestions.map((s, idx) => (
              <OutfitCard
                key={s.id}
                suggestion={s}
                rank={idx + 1}
                wardrobeMap={wardrobeMap}
                onRate={(rating) => handleRate(s.id, rating)}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

// ── Outfit Card ────────────────────────────────────────────────────────────

function OutfitCard({
  suggestion,
  rank,
  wardrobeMap,
  onRate,
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
      {/* ── Card header ──────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Look #{rank}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
            <h2 style={{ fontSize: "20px", fontFamily: "Playfair Display, serif" }}>
              {getOutfitTitle(suggestion, wardrobeMap)}
            </h2>
            <span className="score-badge">
              {Math.round(suggestion.score * 100)}% match
            </span>
          </div>
        </div>
      </div>

      {/* ── Item grid ────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "24px", overflowX: "auto" }}>
        {items.map((item) => (
          <OutfitItemTile key={item.id} item={item} isAccessory={suggestion.accessory_ids?.includes(item.id)} />
        ))}
        {items.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: "14px" }}>Item images unavailable</p>
        )}
      </div>

      {/* ── AI explanation ────────────────────────────────────────────── */}
      <div
        style={{
          background: "var(--surface)",
          borderRadius: "8px",
          padding: "16px",
          marginBottom: "20px",
          display: "flex",
          gap: "10px",
          alignItems: "flex-start",
        }}
      >
        <Info size={16} color="var(--gold)" style={{ flexShrink: 0, marginTop: "2px" }} />
        <p style={{ fontSize: "14px", color: "var(--ink)", lineHeight: 1.6 }}>
          {suggestion.explanation}
        </p>
      </div>

      {/* ── Star rating ───────────────────────────────────────────────── */}
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
              style={{
                color: star <= (hover || suggestion.user_rating || 0) ? "var(--gold)" : "var(--border)",
              }}
            >
              ★
            </span>
          ))}
        </div>
        {suggestion.user_rating && (
          <span style={{ fontSize: "13px", color: "var(--muted)" }}>
            You rated {suggestion.user_rating}/5
          </span>
        )}
      </div>
    </div>
  );
}

function OutfitItemTile({ item, isAccessory }: { item: ClothingItem; isAccessory?: boolean }) {
  return (
    <div style={{ flexShrink: 0, width: isAccessory ? "100px" : "140px" }}>
      <div
        style={{
          borderRadius: "8px",
          overflow: "hidden",
          background: "var(--surface)",
          aspectRatio: isAccessory ? "1/1" : "3/4",
          border: isAccessory ? "1px dashed var(--border)" : "1px solid var(--border)",
        }}
      >
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
  const colors = [...new Set(items.map((i) => i.color).filter(Boolean))];
  const color  = colors.slice(0, 2).join(" & ");
  return color ? `The ${color} look` : "Complete Look";
}
