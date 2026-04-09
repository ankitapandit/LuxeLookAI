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
import {
  ClothingItem,
  createEvent,
  generateOutfits,
  getWardrobeItems,
  OutfitSuggestion,
  rateOutfit,
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

type StyleDirectionRow = {
  label: string;
  value: string;
};

type StyleDirectionBand = {
  items: StyleDirectionRow[];
};

type StyleDirection = {
  title: string;
  intro: string;
  bands: StyleDirectionBand[];
  final: string;
  avoid: string;
};

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
  const title = getItemTitle(item);
  const details = [item.color, item.season].filter(Boolean).map((value) => titleCase(String(value)));
  return details.length > 0 ? `${title} · ${details.join(" · ")}` : title;
}

function buildStyleDirection(item: ClothingItem, suggestion: OutfitSuggestion | null, wardrobeMap: Record<string, ClothingItem>): StyleDirection {
  const colorFamily = getColorFamily(item.color);
  const itemLabel = getItemTitle(item);
  const category = item.category.toLowerCase();
  const vibeText = (suggestion?.card?.vibe || "").toLowerCase();
  const intro = `If you do not love the looks above, here is the cleaner direction I would take with your ${itemLabel.toLowerCase()}.`;
  const final = `Keep the styling cohesive, let one piece lead, and avoid anything that fights the shape or texture of the item.`;
  const suggestionItems = suggestion
    ? [...suggestion.item_ids, ...(suggestion.accessory_ids || [])]
        .map((id) => wardrobeMap[id])
        .filter(Boolean)
    : [];
  const suggestionCoreItems = suggestionItems.filter((candidate) => String(candidate.id) !== String(item.id));

  const topItem = findMatchingItem(suggestionCoreItems, ["tops"]);
  const bottomItem = findMatchingItem(suggestionCoreItems, ["bottoms"]);
  const dressItem = findMatchingItem(suggestionCoreItems, ["dresses"]);
  const shoeItem = findMatchingItem(suggestionCoreItems, ["shoes"]);
  const outerwearItem = findMatchingItem(suggestionCoreItems, ["outerwear"]);
  const jewelryItem = findMatchingItem(suggestionCoreItems, [], ["jewelry", "necklace", "earring", "bracelet", "ring", "watch"]);

  const baseBand: StyleDirectionRow[] = (() => {
    if (category === "dresses") {
      return [{ label: "Dress", value: describeSuggestedItem(dressItem || item, "A clean dress silhouette") }];
    }
    if (category === "tops") {
      return [{ label: "Bottom", value: describeSuggestedItem(bottomItem, "Tailored high-waist trousers or a clean skirt") }];
    }
    if (category === "bottoms") {
      return [{ label: "Top", value: describeSuggestedItem(topItem, colorFamily === "pink" ? "White textured bodysuit" : colorFamily === "dark neutral" ? "Ivory fitted top" : "Crisp ivory bodysuit") }];
    }
    if (category === "outerwear") {
      return [
        { label: "Top", value: describeSuggestedItem(topItem, "Simple fitted top or slim knit") },
        { label: "Bottom", value: describeSuggestedItem(bottomItem, "Tailored trouser or straight skirt") },
      ];
    }
    if (dressItem) {
      return [{ label: "Dress", value: describeSuggestedItem(dressItem, "A clean dress silhouette") }];
    }
    return [
      { label: "Top", value: describeSuggestedItem(topItem, "Clean fitted top or bodysuit") },
      { label: "Bottom", value: describeSuggestedItem(bottomItem, "Tailored trouser, straight skirt, or clean denim") },
    ];
  })();

  const supportBand: StyleDirectionRow[] = [
    { label: "Shoes", value: describeSuggestedItem(shoeItem, category === "dresses" ? "Simple heeled sandals or refined flats" : "Simple heel or polished flat") },
    { label: "Outerwear", value: describeSuggestedItem(outerwearItem, category === "outerwear" ? "The outer layer should stay sharp and the base should stay clean" : "Light blazer, wrap, or cardigan") },
  ];

  const finishBand: StyleDirectionRow[] = [
    { label: "Hair", value: vibeText.includes("confident") || vibeText.includes("statement") ? "Sleek bun or polished blowout" : "Soft waves or a polished bun" },
    { label: "Makeup", value: colorFamily === "pink" || colorFamily === "warm" ? "Glow-forward skin and a soft lip" : "Clean skin, soft definition, and a neutral lip" },
    { label: "Jewelry", value: describeSuggestedItem(jewelryItem, colorFamily === "dark neutral" || colorFamily === "blue" ? "Gold or silver, but keep it minimal" : "Gold hoops or a delicate chain") },
  ];

  const avoidByCategory: Record<string, string> = {
    bottoms: "Avoid bulky layers or a dark top that makes the look feel closed in.",
    tops: "Avoid an overly loose bottom that swallows the shape.",
    dresses: "Avoid heavy add-ons that fight the dress line.",
    outerwear: "Avoid a bulky base that creates unnecessary volume.",
    shoes: "Avoid too many competing details around the hemline.",
    accessories: "Avoid clutter around the focal piece.",
    set: "Avoid mixing in pieces that compete with the set.",
    swimwear: "Avoid anything heavy that works against the easy silhouette.",
  };

  return {
    title: "What works best",
    intro,
    bands: [
      { items: baseBand },
      { items: supportBand },
      { items: finishBand },
    ],
    final,
    avoid: avoidByCategory[category] || "Avoid anything that fights the shape or texture of the item.",
  };
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
  const [occasionText, setOccasionText] = useState("");
  const [eventId, setEventId] = useState<string | null>(null);
  const [allShownIds, setAllShownIds] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<OutfitSuggestion[]>([]);
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);
  const [missingItems, setMissingItems] = useState<string[]>([]);
  const [coverageHints, setCoverageHints] = useState<string[]>([]);
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
  const activeSuggestion = suggestions.find((suggestion) => suggestion.id === activeSuggestionId) || suggestions[0] || null;
  const styleDirection = selectedItem ? buildStyleDirection(selectedItem, activeSuggestion, wardrobeMap) : null;

  useEffect(() => {
    setActiveSuggestionId(suggestions[0]?.id ?? null);
  }, [suggestions]);

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
    if (!occasionText.trim()) {
      toast.error("Add a short occasion description");
      return;
    }

    setLoading(true);
    const existingEventId = eventId;
    if (!moreLooks) {
      clearResults(true);
    }

    try {
      let currentEventId = moreLooks ? existingEventId : null;
      if (!currentEventId) {
        const event = await createEvent(occasionText.trim());
        currentEventId = event.id;
        setEventId(currentEventId);
      }

      const response = await generateOutfits(
        currentEventId,
        5,
        moreLooks ? allShownIds : undefined,
        false,
        selectedItemId,
      );

      setSuggestions(response.suggestions);
      setMissingItems(response.missing_items || []);
      setCoverageHints(response.coverage_hints || []);
      setAllShownIds((prev) => {
        const nextIds = response.suggestions.map((suggestion) => suggestion.id);
        return moreLooks ? [...prev, ...nextIds] : nextIds;
      });
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (response.status === "text_only") {
        toast("No complete outfit yet, but we found a strong direction.");
      }
    } catch (err: unknown) {
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
      <Head><title>Discover — LuxeLook AI</title></Head>
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
                Discover
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
              Build the outfit around one piece.
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
              Pick a wardrobe item, describe the occasion, and we’ll shape a look around it.
              If the wardrobe covers the full board, you get a moodboard. If not, you get a clear styling direction.
            </p>

            <div style={{ display: "grid", gap: "14px", marginTop: "22px", maxWidth: "38rem" }}>
              <label style={{ display: "grid", gap: "8px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(247,240,230,0.72)" }}>
                  Occasion
                </span>
                <textarea
                  className="input"
                  value={occasionText}
                  onChange={(e) => {
                    setOccasionText(e.target.value);
                    clearResults(true);
                  }}
                  placeholder="e.g. Dinner date at a rooftop restaurant, elegant but relaxed"
                  rows={4}
                  style={{
                    resize: "vertical",
                    borderColor: "rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#F7F0E6",
                  }}
                />
              </label>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {[
                  "Rooftop dinner",
                  "Wedding guest",
                  "Office event",
                  "Weekend brunch",
                ].map((chip) => (
                  <button
                    key={chip}
                    onClick={() => {
                      setOccasionText(chip);
                      clearResults(true);
                    }}
                    style={{
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(255,255,255,0.04)",
                      color: "#F7F0E6",
                      borderRadius: "999px",
                      padding: "8px 12px",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  className="btn-primary"
                  onClick={() => runStyling(false)}
                  disabled={loading || !selectedItemId || !occasionText.trim()}
                  style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
                >
                  <Sparkles size={16} />
                  {loading ? "Styling…" : "Discover"}
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
              borderRadius: "28px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              padding: "18px",
              minHeight: "100%",
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
                  minHeight: "100%",
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
            <div
              style={{
                padding: "24px",
                borderRadius: "22px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <p className="type-kicker" style={{ margin: 0, fontSize: "11px", color: "var(--muted)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                Styling in progress
              </p>
              <p style={{ margin: "10px 0 0", color: "var(--muted)", lineHeight: 1.6 }}>
                We’re pulling the strongest options from your wardrobe and shaping the outfit around your selected piece.
              </p>
            </div>
          ) : suggestions.length > 0 ? (
            <div className="outfit-carousel" style={{ marginTop: "6px" }}>
              {suggestions.map((suggestion, index) => (
                <div
                  key={suggestion.id}
                  className="outfit-card-wrap"
                  onMouseEnter={() => setActiveSuggestionId(suggestion.id)}
                  style={{ minWidth: "280px", maxWidth: "320px" }}
                >
                  <OutfitSuggestionCard
                    suggestion={suggestion}
                    rank={index + 1}
                    wardrobeMap={wardrobeMap}
                    onRate={(rating) => handleRate(suggestion.id, rating)}
                    compact
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

          {styleDirection && suggestions.length > 0 ? (
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
                      <div
                        key={bandIndex}
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "10px",
                        }}
                      >
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

          {coverageHints.length > 0 && suggestions.length > 0 ? (
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
