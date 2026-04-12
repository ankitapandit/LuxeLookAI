/**
 * pages/style-item.tsx — Style an item page
 *
 * The user picks one wardrobe item, describes the occasion, and the app
 * returns outfit ideas built around that item. When the engine can assemble a
 * full wardrobe-only look, we render the standard outfit cards. When it cannot,
 * we fall back to a short editorial note and missing-piece hints.
 */

import { useEffect, useRef, useState } from "react";
import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import Navbar from "@/components/layout/Navbar";
import OutfitSuggestionCard from "@/components/OutfitSuggestionCard";
import EventBriefEditor, { createDefaultEventBriefValues, EventBriefValues, serializeEventBrief, summarizeEventBrief } from "@/components/EventBriefEditor";
import LookAssemblyLoader from "@/components/LookAssemblyLoader";
import {
  ClothingItem,
  createEvent,
  generateOutfits,
  getWardrobeItems,
  OutfitSuggestion,
  rateOutfit,
  StyleDirectionData,
} from "@/services/api";
import { ChevronDown, Search, Sparkles, RefreshCw, ShirtIcon, ArrowRight } from "lucide-react";
import toast from "react-hot-toast";

const CATEGORY_FILTERS = [
  "all",
  "tops",
  "bottoms",
  "dresses",
  "outerwear",
  "shoes",
  "accessories",
  "jewelry",
  "set",
  "swimwear",
  "loungewear",
];

function titleCase(value: string): string {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function shouldBypassImageOptimization(src: string): boolean {
  return src.startsWith("blob:") || src.startsWith("data:");
}

function getImageSrc(item: ClothingItem): string {
  return item.thumbnail_url || item.image_url || "";
}

function getCarouselImageSrc(item: ClothingItem): string {
  return item.thumbnail_url || item.image_url || item.cutout_url || "";
}

function getItemTitle(item: ClothingItem): string {
  if (item.accessory_subtype) return titleCase(item.accessory_subtype);
  if (item.item_type && !["core_garment", "footwear", "outerwear", "accessory"].includes(item.item_type)) {
    return titleCase(item.item_type);
  }
  return titleCase(item.category);
}

function getItemSummary(item: ClothingItem): string {
  const parts = [item.category, item.color, item.season].filter(Boolean);
  return parts.map((part) => titleCase(String(part))).join(" · ");
}


function StyledItemTile({
  item,
  selected,
  onSelect,
}: {
  item: ClothingItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const imageSrc = getImageSrc(item);

  return (
    <button
      onClick={onSelect}
      className="card"
      style={{
        position: "relative",
        overflow: "hidden",
        textAlign: "left",
        padding: 0,
        cursor: "pointer",
        border: selected ? "1px solid rgba(212,169,106,0.65)" : "1px solid var(--border)",
        boxShadow: selected ? "0 18px 36px rgba(0,0,0,0.12)" : "none",
        transform: selected ? "translateY(-2px)" : "none",
        transition: "all 0.18s ease",
      }}
    >
      <div style={{ position: "relative", aspectRatio: "3 / 4", background: "var(--surface)" }}>
        <Image
          src={imageSrc}
          alt={getItemTitle(item)}
          fill
          unoptimized={shouldBypassImageOptimization(imageSrc)}
          sizes="(max-width: 900px) 44vw, 260px"
          style={{ objectFit: "contain", padding: "16px", background: "linear-gradient(180deg, #2A221A 0%, #17120D 100%)" }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: selected
              ? "linear-gradient(180deg, rgba(24, 20, 15, 0.04), rgba(24, 20, 15, 0.28))"
              : "linear-gradient(180deg, rgba(24, 20, 15, 0.00), rgba(24, 20, 15, 0.18))",
          }}
        />
      </div>

      <div style={{ padding: "12px 12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "var(--charcoal)" }}>
            {getItemTitle(item)}
          </p>
          <span style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)" }}>
            {titleCase(item.category)}
          </span>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--muted)", lineHeight: 1.45 }}>
          {getItemSummary(item)}
        </p>
      </div>
    </button>
  );
}

export default function StyleItemPage() {
  const router = useRouter();
  const resultRef = useRef<HTMLDivElement | null>(null);

  const [wardrobe, setWardrobe] = useState<ClothingItem[]>([]);
  const [loadingWardrobe, setLoadingWardrobe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [brief, setBrief] = useState<EventBriefValues>(createDefaultEventBriefValues());
  const [eventId, setEventId] = useState<string | null>(null);
  const [allShownIds, setAllShownIds] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<OutfitSuggestion[]>([]);
  const [missingItems, setMissingItems] = useState<string[]>([]);
  const [coverageHints, setCoverageHints] = useState<string[]>([]);
  const [styleDirectionData, setStyleDirectionData] = useState<StyleDirectionData | null>(null);
  const [showExpertSuggestion, setShowExpertSuggestion] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadWardrobe() {
      setLoadingWardrobe(true);
      try {
        const items = await getWardrobeItems();
        if (!active) return;
        setWardrobe(items);
        if (items.length === 1) {
          setSelectedItemId(items[0].id);
        }
      } catch {
        toast.error("Could not load wardrobe items");
      } finally {
        if (active) setLoadingWardrobe(false);
      }
    }

    void loadWardrobe();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    const queryItemId = router.query.itemId;
    if (typeof queryItemId !== "string") return;
    if (wardrobe.some((item) => item.id === queryItemId)) {
      setSelectedItemId(queryItemId);
    }
  }, [router.isReady, router.query.itemId, wardrobe]);

  const selectedItem = wardrobe.find((item) => item.id === selectedItemId) || null;
  const wardrobeMap = Object.fromEntries(wardrobe.map((item) => [item.id, item]));

  const filteredWardrobe = wardrobe.filter((item) => {
    const matchesFilter = selectedFilter === "all" || item.category === selectedFilter;
    const haystack = `${item.category} ${item.color || ""} ${item.item_type || ""} ${item.accessory_subtype || ""}`.toLowerCase();
    const matchesSearch = !searchTerm.trim() || haystack.includes(searchTerm.trim().toLowerCase());
    return matchesFilter && matchesSearch;
  });

  function clearResults(resetSession: boolean = true) {
    setSuggestions([]);
    setMissingItems([]);
    setCoverageHints([]);
    setStyleDirectionData(null);
    if (resetSession) {
      setEventId(null);
      setAllShownIds([]);
    }
  }

  function handleSelectItem(itemId: string) {
    setSelectedItemId(itemId);
    clearResults(true);
  }

  async function runStyling(moreLooks: boolean = false) {
    const anchorItem = wardrobe.find((item) => item.id === selectedItemId);
    if (!anchorItem) {
      toast.error("Pick a wardrobe item first");
      return;
    }

    setLoading(true);
    const existingEventId = eventId;
    if (!moreLooks) {
      clearResults(true);
    }

    try {
      let currentEventId = moreLooks ? existingEventId : null;
      const prompt = summarizeEventBrief(brief, "Style this item around the selected anchor piece.");
      const promptJson = serializeEventBrief(brief);
      console.info("[Style Item] build looks clicked", {
        moreLooks,
        selectedItemId,
        anchorCategory: anchorItem.category,
        brief,
        promptPreview: prompt.slice(0, 220),
      });
      if (!currentEventId) {
        const event = await createEvent(prompt, promptJson);
        currentEventId = event.id;
        setEventId(currentEventId);
        console.info("[Style Item] event created", { eventId: currentEventId, selectedItemId });
      } else {
        console.info("[Style Item] reusing event", { eventId: currentEventId, selectedItemId, moreLooks });
      }

      const response = await generateOutfits(
        currentEventId,
        5,
        moreLooks ? allShownIds : undefined,
        false,
        selectedItemId,
      );
      console.info("[Style Item] generate outfits response", {
        eventId: currentEventId,
        selectedItemId,
        status: response.status ?? null,
        suggestionCount: response.suggestions.length,
        missingItems: response.missing_items || [],
        coverageHints: response.coverage_hints || [],
      });

      setSuggestions(response.suggestions);
      setMissingItems(response.missing_items || []);
      setCoverageHints(response.coverage_hints || []);
      setStyleDirectionData(response.style_direction || null);
      setAllShownIds((prev) => {
        const nextIds = response.suggestions.map((suggestion) => suggestion.id);
        return moreLooks ? [...prev, ...nextIds] : nextIds;
      });
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (response.status === "text_only") {
        toast("No complete outfit yet, but we found a strong direction.");
      }
    } catch (err: unknown) {
      console.error("[Style Item] build looks failed", err);
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e?.response?.data?.detail || "Could not build looks");
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
      toast.success("Rating saved!");
    } catch {
      toast.error("Could not save rating");
    }
  }

  return (
    <>
      <Head><title>Style Item — LuxeLook AI</title></Head>
      <Navbar />

      <main className="page-main" style={{ maxWidth: "1240px", margin: "0 auto", padding: "32px 24px 72px" }}>
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "28px",
            padding: "28px",
            borderRadius: "32px",
            background: "linear-gradient(145deg, #17130F 0%, #221C16 56%, #35281E 100%)",
            border: "1px solid rgba(255,255,255,0.06)",
            boxShadow: "0 22px 54px rgba(0,0,0,0.12)",
            color: "#F7F0E6",
            marginBottom: "28px",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
              <Sparkles size={20} color="#D4A96A" />
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "rgba(247,240,230,0.72)",
                }}
              >
                Style Item
              </span>
            </div>

              <h1
                style={{
                margin: 0,
                fontFamily: "Playfair Display, serif",
                fontSize: "clamp(38px, 4.7vw, 62px)",
                lineHeight: 0.95,
                letterSpacing: "-0.05em",
                maxWidth: "11ch",
              }}
            >
              Build the outfit around one anchor piece.
            </h1>

            <p
              style={{
                margin: "16px 0 0",
                maxWidth: "42rem",
                color: "rgba(247,240,230,0.75)",
                fontSize: "15px",
                lineHeight: 1.7,
              }}
            >
              Start with one anchor piece and let us build the silhouette around it.
              If the item is enough to carry the look, we’ll show the board. If not, we’ll fill in the missing pieces with intention.
            </p>

            <div style={{ display: "grid", gap: "14px", marginTop: "22px", maxWidth: "38rem" }}>
              <EventBriefEditor values={brief} onChange={setBrief} mobileCompact />

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  className="btn-primary"
                  onClick={() => runStyling(false)}
                  disabled={loading || !selectedItemId}
                  style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
                >
                  <Sparkles size={16} />
                  {loading ? "Styling…" : "Style Item"}
                </button>

                {eventId && suggestions.length > 0 ? (
                  <button
                    className="btn-secondary"
                    onClick={() => runStyling(true)}
                    disabled={loading}
                    style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
                  >
                    <RefreshCw size={14} />
                    More looks
                  </button>
                ) : null}

                {eventId ? (
                  <button
                    className="btn-secondary"
                    onClick={() => clearResults(true)}
                    disabled={loading}
                    style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
                  >
                    Reset
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div
            style={{
              alignSelf: "start",
              borderRadius: "28px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              padding: "18px",
            }}
          >
            {selectedItem ? (
              <div style={{ display: "grid", gap: "16px" }}>
                <div style={{ position: "relative", aspectRatio: "4 / 5", borderRadius: "22px", overflow: "hidden", background: "rgba(255,255,255,0.05)" }}>
                  <Image
                    src={getCarouselImageSrc(selectedItem)}
                    alt={getItemTitle(selectedItem)}
                    fill
                    unoptimized={shouldBypassImageOptimization(getCarouselImageSrc(selectedItem))}
                    sizes="(max-width: 900px) 90vw, 440px"
                    style={{ objectFit: "contain", padding: "18px", background: "linear-gradient(180deg, #2B241C 0%, #191510 100%)" }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "linear-gradient(180deg, rgba(14,12,9,0.10) 0%, rgba(14,12,9,0.42) 100%)",
                    }}
                  />
                  <div style={{ position: "absolute", left: "16px", right: "16px", bottom: "16px" }}>
                    <h2
                      style={{
                        margin: 0,
                        fontFamily: "Playfair Display, serif",
                        fontSize: "clamp(30px, 4vw, 42px)",
                        lineHeight: 0.95,
                        color: "#FFF7ED",
                        maxWidth: "11ch",
                      }}
                    >
                      {getItemTitle(selectedItem)}
                    </h2>
                    <p style={{ margin: "10px 0 0", color: "rgba(255,247,237,0.78)", fontSize: "13px" }}>
                      {getItemSummary(selectedItem)}
                    </p>
                  </div>
                </div>

                <div style={{ display: "grid", gap: "10px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    <span className="type-chip" style={{ background: "rgba(17, 15, 12, 0.58)", color: "#FFF7ED", border: "1px solid rgba(212,169,106,0.18)" }}>
                      {titleCase(selectedItem.category)}
                    </span>
                    {selectedItem.color ? (
                      <span className="type-chip" style={{ background: "rgba(17, 15, 12, 0.58)", color: "#FFF7ED", border: "1px solid rgba(212,169,106,0.18)" }}>
                        {titleCase(selectedItem.color)}
                      </span>
                    ) : null}
                    {selectedItem.season ? (
                      <span className="type-chip" style={{ background: "rgba(17, 15, 12, 0.58)", color: "#FFF7ED", border: "1px solid rgba(212,169,106,0.18)" }}>
                        {titleCase(selectedItem.season)}
                      </span>
                    ) : null}
                  </div>

                  <p style={{ margin: 0, color: "rgba(255,247,237,0.76)", fontSize: "14px", lineHeight: 1.6 }}>
                    {selectedItem.descriptors && Object.keys(selectedItem.descriptors).length > 0
                      ? "We’ll use the item’s shape and finish to pull the rest of the look together."
                      : "Choose another item if you want a different mood or silhouette."}
                  </p>
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  placeItems: "center",
                  textAlign: "center",
                  padding: "48px 16px",
                  color: "rgba(247,240,230,0.72)",
                }}
              >
                <div>
                  <div style={{
                    width: "72px",
                    height: "72px",
                    borderRadius: "24px",
                    margin: "0 auto 16px",
                    background: "rgba(255,255,255,0.06)",
                    display: "grid",
                    placeItems: "center",
                  }}>
                    <ShirtIcon size={28} color="rgba(247,240,230,0.82)" />
                  </div>
                  <h2 style={{ margin: 0, fontFamily: "Playfair Display, serif", fontSize: "32px", color: "#FFF7ED" }}>
                    Select an item to begin
                  </h2>
                  <p style={{ margin: "10px auto 0", maxWidth: "26rem", lineHeight: 1.65 }}>
                    Choose the piece you’re in the mood for, then tell us where you’re wearing it.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section
          ref={resultRef}
          style={{
            marginBottom: "28px",
            padding: "20px 22px",
            borderRadius: "24px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            position: "relative",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "16px", marginBottom: "14px", flexWrap: "wrap" }}>
            <div>
              <p className="type-kicker" style={{ margin: 0, fontSize: "11px", color: "var(--muted)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                Result
              </p>
              <h2 className="type-section-title" style={{ margin: "6px 0 0", fontSize: "22px", color: "var(--charcoal)" }}>
                Styled around your item
              </h2>
            </div>

          </div>

          {loading ? (
            <LookAssemblyLoader
              title="Styling your item"
              subtitle="We’re shaping the outfit around your selected piece, testing balance, finish, and the cleanest supporting options."
            />
          ) : suggestions.length > 0 ? (
            <div className="outfit-carousel" style={{ marginTop: "6px" }}>
              {suggestions.map((suggestion, index) => (
                <div
                  key={suggestion.id}
                  className="outfit-card-wrap"
                  style={{ minWidth: "280px", maxWidth: "320px" }}
                >
                  <OutfitSuggestionCard
                    suggestion={suggestion}
                    rank={index + 1}
                    wardrobeMap={wardrobeMap}
                    onRate={(rating) => handleRate(suggestion.id, rating)}
                    compact
                    showMetricsWhenCompact
                    imageMode="cutout"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: "24px",
                borderRadius: "22px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              {missingItems.length > 0 ? (
                <>
                  <p className="type-kicker" style={{ margin: 0, fontSize: "11px", color: "var(--muted)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                    Missing pieces
                  </p>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
                    {missingItems.map((item) => (
                      <span
                        key={item}
                        className="type-chip"
                        style={{
                          background: "rgba(212,169,106,0.08)",
                          color: "var(--charcoal)",
                          border: "1px solid rgba(212,169,106,0.14)",
                        }}
                        >
                          {item}
                        </span>
                      ))}
                  </div>
                  <p style={{ margin: "14px 0 0", color: "var(--muted)", lineHeight: 1.65, fontSize: "14px" }}>
                    {missingItems.some((item) => /shoe/i.test(item))
                      ? "Add at least one pair of shoes — every outfit template needs footwear."
                      : "Add at least one pair of shoes to ground the outfit."}
                    {" "}
                    {missingItems.some((item) => /bottom/i.test(item))
                      ? "Add at least one bottom (trousers or skirt) to complete the cleaner templates."
                      : ""}
                  </p>
                </>
              ) : (
                <>
                  <p className="type-kicker" style={{ margin: 0, fontSize: "11px", color: "var(--muted)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                    Waiting for input
                  </p>
                  <p style={{ margin: "10px 0 0", color: "var(--muted)", lineHeight: 1.6 }}>
                    Select an item, write the occasion, and we’ll build the first direction.
                  </p>
                </>
              )}
            </div>
          )}

          {styleDirectionData && styleDirectionData.options.length > 0 ? (
            <div
              style={{
                marginTop: "18px",
                padding: "20px",
                borderRadius: "22px",
                background: "linear-gradient(145deg, rgba(212,169,106,0.10) 0%, rgba(255,255,255,0.04) 100%)",
                border: "1px solid rgba(212,169,106,0.18)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <div>
                  <p className="type-kicker" style={{ margin: 0, fontSize: "11px", color: "var(--gold)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                    Experts Suggest
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
                      {/* Option header */}
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                        <span style={{ fontSize: "22px", lineHeight: 1 }}>{option.emoji}</span>
                        <h4 style={{ margin: 0, fontFamily: "Playfair Display, serif", fontSize: "18px", color: "#FFF7ED", lineHeight: 1.15 }}>
                          {option.name}
                        </h4>
                      </div>

                      {/* Pieces — grouped into 3 rows */}
                      {(() => {
                        const garmentOrder = ["top", "base", "dress", "bottom", "shoes", "footwear"];
                        const accessoryOrder = ["accessories", "accessory", "bag", "jewelry", "outerwear"];
                        const finishOrder = ["hair", "makeup"];

                        const classify = (label: string) => {
                          const l = label.toLowerCase();
                          if (finishOrder.includes(l)) return "finish";
                          if (accessoryOrder.includes(l)) return "accessory";
                          return "garment"; // top/base/dress/bottom/shoes and anything else
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

                      {/* Why it works */}
                      <p style={{ margin: 0, color: "rgba(255,247,237,0.88)", fontSize: "13px", lineHeight: 1.65, fontStyle: "italic" }}>
                        <strong style={{ color: "var(--gold)", fontStyle: "normal", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.10em", marginRight: "6px" }}>Why it works</strong>
                        {option.why}
                      </p>

                      {/* Practical tip */}
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

          {coverageHints.length > 0 ? (
            <div
              style={{
                marginTop: "18px",
                padding: "18px 20px",
                borderRadius: "20px",
                background: "rgba(212,169,106,0.05)",
                border: "1px solid rgba(212,169,106,0.14)",
              }}
            >
              <p className="type-kicker" style={{ margin: 0, fontSize: "11px", color: "var(--gold)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                Wardrobe notes
              </p>
              <div style={{ display: "grid", gap: "6px", marginTop: "10px" }}>
                {coverageHints.map((hint) => (
                  <p key={hint} style={{ margin: 0, color: "var(--muted)", fontSize: "13px", lineHeight: 1.55 }}>
                    {hint}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section
          style={{
            marginBottom: "28px",
            padding: "20px 22px",
            borderRadius: "24px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "18px", alignItems: "end", flexWrap: "wrap", marginBottom: "14px" }}>
            <div>
              <p className="type-kicker" style={{ margin: 0, fontSize: "11px", color: "var(--muted)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                Wardrobe
              </p>
              <h2 className="type-section-title" style={{ margin: "6px 0 0", fontSize: "22px", color: "var(--charcoal)" }}>
                Pick your piece
              </h2>
            </div>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ position: "relative", minWidth: "240px" }}>
                <Search size={14} color="var(--muted)" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }} />
                <input
                  className="input"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search wardrobe"
                  style={{ paddingLeft: "34px", minWidth: "240px" }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "18px" }}>
            {CATEGORY_FILTERS.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedFilter(category)}
                className="type-chip"
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "999px",
                  padding: "7px 12px",
                  background: selectedFilter === category ? "rgba(212,169,106,0.12)" : "var(--surface)",
                  color: selectedFilter === category ? "var(--charcoal)" : "var(--muted)",
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {category}
              </button>
            ))}
          </div>

          {loadingWardrobe ? (
            <div style={{ textAlign: "center", padding: "42px 24px", color: "var(--muted)" }}>
              Loading wardrobe…
            </div>
          ) : wardrobe.length === 0 ? (
            <div style={{ textAlign: "center", padding: "42px 24px", color: "var(--muted)" }}>
              <p style={{ margin: 0, fontSize: "15px" }}>Your wardrobe is empty.</p>
              <p style={{ margin: "8px 0 0", fontSize: "13px" }}>
                Upload items first, then come back here to style them.
              </p>
              <Link href="/wardrobe" style={{ display: "inline-flex", alignItems: "center", gap: "8px", marginTop: "14px", textDecoration: "none" }}>
                <span className="btn-secondary">Go to wardrobe</span>
              </Link>
            </div>
          ) : filteredWardrobe.length === 0 ? (
            <div style={{ textAlign: "center", padding: "42px 24px", color: "var(--muted)" }}>
              <p style={{ margin: 0, fontSize: "15px" }}>No items match this filter.</p>
              <button
                className="btn-secondary"
                onClick={() => {
                  setSelectedFilter("all");
                  setSearchTerm("");
                }}
                style={{ marginTop: "12px" }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                gap: "14px",
              }}
            >
              {filteredWardrobe.map((item) => (
                <StyledItemTile
                  key={item.id}
                  item={item}
                  selected={item.id === selectedItemId}
                  onSelect={() => handleSelectItem(item.id)}
                />
              ))}
            </div>
          )}
        </section>

        <div style={{ marginTop: "34px", display: "flex", justifyContent: "center" }}>
          <Link href="/wardrobe" style={{ textDecoration: "none" }}>
            <span
              className="btn-secondary"
              style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
            >
              Back to wardrobe
              <ArrowRight size={14} />
            </span>
          </Link>
        </div>
      </main>
    </>
  );
}
