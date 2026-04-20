import { ClothingItem } from "@/services/api";

const COLOR_LABELS: Record<string, string> = {
  black: "Black",
  white: "White",
  navy: "Navy",
  beige: "Beige",
  red: "Red",
  green: "Green",
  grey: "Grey",
  gray: "Grey",
  brown: "Brown",
  pink: "Pink",
  blue: "Blue",
  yellow: "Yellow",
  orange: "Orange",
  purple: "Purple",
  cream: "Cream",
  tan: "Tan",
  olive: "Olive",
  gold: "Gold",
  silver: "Silver",
  multicolor: "Multicolor",
  pattern: "Pattern",
};

const SINGULAR_CATEGORY_LABELS: Record<string, string> = {
  tops: "Top",
  bottoms: "Bottom",
  dresses: "Dress",
  jumpsuits: "Jumpsuit",
  outerwear: "Outerwear",
  shoes: "Shoes",
  accessories: "Accessory",
  jewelry: "Jewelry",
  set: "Set",
  swimwear: "Swimsuit",
  loungewear: "Loungewear",
};

const GENERIC_DESCRIPTOR_VALUES = new Set([
  "",
  "none",
  "regular",
  "all",
  "standard",
  "classic",
]);

function titleCase(value: string): string {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getDisplayColorName(color?: string): string {
  if (!color) return "";
  if (color.startsWith("#")) return color.toUpperCase();
  const normalized = color.toLowerCase().trim();
  return COLOR_LABELS[normalized] || titleCase(color);
}

function getDescriptorValue(item: ClothingItem, key: string): string {
  return String(item.descriptors?.[key] || "").trim();
}

function getItemNoun(item: ClothingItem): string {
  const category = String(item.category || "").toLowerCase().trim();

  if (category === "accessories") {
    return (
      getDescriptorValue(item, "accessory_type")
      || String(item.accessory_subtype || "").trim()
      || SINGULAR_CATEGORY_LABELS[category]
      || titleCase(category)
    );
  }

  if (category === "jewelry") {
    return (
      getDescriptorValue(item, "jewelry_type")
      || String(item.accessory_subtype || "").trim()
      || SINGULAR_CATEGORY_LABELS[category]
      || titleCase(category)
    );
  }

  if (category === "outerwear") {
    return getDescriptorValue(item, "outerwear_type") || SINGULAR_CATEGORY_LABELS[category] || titleCase(category);
  }

  if (category === "shoes") {
    return getDescriptorValue(item, "shoe_type") || SINGULAR_CATEGORY_LABELS[category] || titleCase(category);
  }

  if (category === "tops") {
    return getDescriptorValue(item, "top_style") || SINGULAR_CATEGORY_LABELS[category] || titleCase(category);
  }

  if (category === "bottoms") {
    return getDescriptorValue(item, "bottom_style") || SINGULAR_CATEGORY_LABELS[category] || titleCase(category);
  }

  if (category === "jumpsuits") {
    return SINGULAR_CATEGORY_LABELS[category] || titleCase(category);
  }

  if (category === "swimwear") {
    return getDescriptorValue(item, "swimwear_style") || SINGULAR_CATEGORY_LABELS[category] || titleCase(category);
  }

  return SINGULAR_CATEGORY_LABELS[category] || titleCase(category);
}

function getDescriptorPriority(item: ClothingItem): string[] {
  const category = String(item.category || "").toLowerCase().trim();
  if (category === "dresses") return ["neckline", "fit", "length", "fabric_type"];
  if (category === "tops") return ["neckline", "fit", "length", "fabric_type"];
  if (category === "bottoms") return ["fit", "length", "fabric_type"];
  if (category === "jumpsuits") return ["jumpsuit_style", "neckline", "fit", "length", "leg_shape", "fabric_type"];
  if (category === "outerwear") return ["fit", "length", "fabric_type"];
  if (category === "shoes") return ["heel_height", "fit"];
  if (category === "jewelry") return ["style", "length"];
  if (category === "accessories") return ["style"];
  if (category === "set") return ["fit", "length", "fabric_type"];
  if (category === "swimwear") return ["fit", "neckline"];
  if (category === "loungewear") return ["fit", "fabric_type"];
  return ["fit", "length", "fabric_type"];
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ");
}

function getNameDescriptors(item: ClothingItem, noun: string): string[] {
  const nounKey = normalizeToken(noun);
  const seen = new Set<string>();
  const descriptors: string[] = [];

  for (const key of getDescriptorPriority(item)) {
    const value = getDescriptorValue(item, key);
    const normalized = normalizeToken(value);
    if (!normalized) continue;
    if (GENERIC_DESCRIPTOR_VALUES.has(normalized)) continue;
    if (normalized === nounKey) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    descriptors.push(value);
    if (descriptors.length >= 2) break;
  }

  return descriptors;
}

export function getItemDisplayName(item: ClothingItem): string {
  const noun = getItemNoun(item);
  const descriptors = getNameDescriptors(item, noun);
  const color = getDisplayColorName(item.color);
  const parts = [color, ...descriptors.map(titleCase), titleCase(noun)].filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim() || titleCase(item.category || "Item");
}

export function getItemDisplaySummary(item: ClothingItem): string {
  const parts = [getDisplayColorName(item.color), item.season ? titleCase(item.season) : ""].filter(Boolean);
  return parts.join(" · ");
}
