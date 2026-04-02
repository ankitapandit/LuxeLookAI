/**
 * services/api.ts — Centralised API client
 * ==========================================
 * All HTTP calls to the FastAPI backend go through this module.
 * Automatically attaches the JWT from localStorage to every request.
 */

import axios, { AxiosInstance } from "axios";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const AUTH_TOKEN_KEY = "luxelook_token";
export const AUTH_USER_ID_KEY = "luxelook_user_id";
export const AUTH_CHANGED_EVENT = "luxelook-auth-changed";

// ── Axios instance ────────────────────────────────────────────────────────
const api: AxiosInstance = axios.create({ baseURL: BASE_URL });

export interface StoredAuth {
  token: string | null;
  userId: string | null;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function getStoredAuth(): StoredAuth {
  if (!isBrowser()) {
    return { token: null, userId: null };
  }

  return {
    token: localStorage.getItem(AUTH_TOKEN_KEY),
    userId: localStorage.getItem(AUTH_USER_ID_KEY),
  };
}

function notifyAuthChanged() {
  if (!isBrowser()) return;
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function persistAuthSession(token: string, userId: string) {
  if (!isBrowser()) return;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_ID_KEY, userId);
  notifyAuthChanged();
}

export function clearStoredAuth() {
  if (!isBrowser()) return;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_ID_KEY);
  notifyAuthChanged();
}

/**
 * Request interceptor — inject the stored JWT as a Bearer token.
 * Called before every outgoing request.
 */
api.interceptors.request.use((config) => {
  if (!isBrowser()) return config;
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      clearStoredAuth();
    }
    return Promise.reject(error);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user_id: string;
}

/** Register a new account. Stores the token on success. */
export async function signup(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/signup", { email, password });
  persistAuthSession(data.access_token, data.user_id);
  return data;
}

/** Log in with existing credentials. Stores the token on success. */
export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/login", { email, password });
  persistAuthSession(data.access_token, data.user_id);
  return data;
}

/** Clear auth state. */
export function logout() {
  clearStoredAuth();
}

export function isLoggedIn(): boolean {
  return !!getStoredAuth().token;
}

// ── Clothing ──────────────────────────────────────────────────────────────

export interface ClothingItem {
  id: string;
  user_id: string;
  category: string;
  item_type: string;
  accessory_subtype?: string;
  color?: string;
  pattern?: string;
  season?: string;
  formality_score?: number;
  image_url: string;
  thumbnail_url?: string;
  cutout_url?: string;
  media_status?: "pending" | "processing" | "ready" | "failed";
  media_stage?: "queued" | "thumbnail" | "cutout" | "complete";
  media_error?: string | null;
  media_updated_at?: string | null;
  created_at: string;
  descriptors?: Record<string, string>;
}

/** AI-predicted tags returned from the preview endpoint, before saving. */
export interface TagPreview {
  category: string;
  item_type: string;
  accessory_subtype?: string;
  color: string;
  season: string;
  formality_score: number;
  formality_label: string;     // human-readable e.g. "Smart casual"
  needs_review: boolean;       // true = AI failed/mocked → show full manual form
  ai_confidence: Record<string, number>;
  descriptors?: Record<string, string>;
  duplicate?: { id: string; category: string; color: string; image_url: string; score: number; } | null;
}

/**
 * Valid values for user-facing dropdowns.
 * Fetched from the backend so UI labels stay in sync with the model's label space.
 */
export interface TagOptions {
  categories: string[];
  colors: string[];
  seasons: { value: string; label: string }[];
  formality_levels: { label: string; score: number; description: string }[];
}

export interface WardrobePageParams {
  limit: number;
  offset: number;
  category?: string;
  season?: string;
  formality?: string;
}

export interface WardrobePageResponse {
  items: ClothingItem[];
  has_more: boolean;
  total_count: number;
}

export async function getWardrobeMediaStatus(itemIds: string[]): Promise<ClothingItem[]> {
  if (!itemIds.length) return [];
  const params = new URLSearchParams();
  itemIds.forEach((id) => params.append("item_ids", id));
  const { data } = await api.get<ClothingItem[]>(`/clothing/items/media-status?${params.toString()}`);
  return data;
}

/**
 * Step 1 of the two-step upload flow.
 * Sends the image to the AI tagger and returns predicted tags.
 * Nothing is saved — this is preview-only so the user can review and correct.
 */
export async function tagPreview(file: File): Promise<TagPreview> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<TagPreview>("/clothing/tag-preview", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

/**
 * Step 2 of the two-step upload flow.
 * Saves the item with the final tags (AI-detected + any user corrections).
 */
export async function uploadClothingItem(
  file: File,
  overrides?: { category?: string; color?: string; pattern?: string; season?: string; formality_label?: string; descriptors?: Record<string, string> }
): Promise<ClothingItem> {
  const form = new FormData();
  form.append("file", file);
  if (overrides?.category)        form.append("category",        overrides.category);
  if (overrides?.color)           form.append("color",           overrides.color);
  if (overrides?.pattern)         form.append("pattern",         overrides.pattern);
  if (overrides?.season)          form.append("season",          overrides.season);
  if (overrides?.formality_label) form.append("formality_label", overrides.formality_label);
  if (overrides?.descriptors && Object.keys(overrides.descriptors).length > 0) {
    form.append("descriptors", JSON.stringify(overrides.descriptors));
  }

  const { data } = await api.post<ClothingItem>("/clothing/upload-item", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

/** Fetch the valid category + color values for correction dropdowns. */
export async function getTagOptions(): Promise<TagOptions> {
  const { data } = await api.get<TagOptions>("/clothing/tag-options");
  return data;
}

/** Correct any tags on an already-saved item. */
export async function correctItem(
  itemId: string,
  corrections: { category?: string; color?: string; pattern?: string; season?: string; formality_label?: string; descriptors?: Record<string, string>  }
): Promise<ClothingItem> {
  const params = new URLSearchParams();
  if (corrections.category)        params.append("category",        corrections.category);
  if (corrections.color)           params.append("color",           corrections.color);
  if (corrections.pattern)         params.append("pattern",         corrections.pattern);
  if (corrections.season)          params.append("season",          corrections.season);
  if (corrections.formality_label) params.append("formality_label", corrections.formality_label);
  if (corrections.descriptors && Object.keys(corrections.descriptors).length > 0)
    params.append("descriptors", JSON.stringify(corrections.descriptors));
  const { data } = await api.patch<ClothingItem>(`/clothing/item/${itemId}?${params}`);
  return data;
}

/** Fetch the user's full wardrobe. */
export async function getWardrobeItems(): Promise<ClothingItem[]> {
  const { data } = await api.get<ClothingItem[]>("/clothing/items");
  return data;
}

/** Fetch a paginated slice of wardrobe items for infinite scroll. */
export async function getWardrobeItemsPage(params: WardrobePageParams): Promise<WardrobePageResponse> {
  const { data } = await api.get<WardrobePageResponse>("/clothing/items/page", { params });
  return data;
}

/** Delete an item by ID (soft-delete — moves to trash, restorable). */
export async function deleteClothingItem(itemId: string): Promise<void> {
  await api.delete(`/clothing/item/${itemId}`);
}

/** Fetch soft-deleted items (trash view). */
export async function getDeletedItems(): Promise<ClothingItem[]> {
  const { data } = await api.get<ClothingItem[]>("/clothing/items/deleted");
  return data;
}

export type RestoreStatus = "restored" | "auto_purged";

/**
 * Restore a soft-deleted item back to the active wardrobe.
 * Returns the outcome status so the UI can show the right message.
 * Throws AxiosError with status 409 when a newer active duplicate exists.
 */
export async function restoreClothingItem(itemId: string): Promise<RestoreStatus> {
  const { data } = await api.post<{ status: RestoreStatus; item_id: string }>(
    `/clothing/item/${itemId}/restore`
  );
  return data.status;
}

// ── Event ─────────────────────────────────────────────────────────────────

export interface Event {
  id: string;
  user_id: string;
  raw_text: string;
  occasion_type: string;
  formality_level: number;
  temperature_context?: string;
  setting?: string;
  event_tokens?: string[];
  created_at: string;
}

/** Create a new event from a free-text description. */
export async function createEvent(rawText: string): Promise<Event> {
  const { data } = await api.post<Event>("/event/create-event", { raw_text: rawText });
  return data;
}

/** Fetch all events for the current user, newest first. */
export async function getEvents(): Promise<Event[]> {
  const { data } = await api.get<Event[]>("/event/list");
  return data;
}

// ── Recommendations ───────────────────────────────────────────────────────

/** Structured 5-row at-a-glance card for an outfit suggestion (v2.0+). */
export interface OutfitCard {
  /** 🔥 Trend-o-meter: 1–5 stars. */
  trend_stars: number;
  /** 🔥 Trend-o-meter label: Outdated | Basic | Classic | Trendy | Statement. */
  trend_label: string;
  /** Editorial moodboard heading shown above the board. */
  look_title?: string;
  /** 💃 Vibe Check: "CoreVibe + Energy" — e.g. "Elegant + Confident". */
  vibe: string;
  /** 🎨 Color Theory palette label — e.g. "Neutral Base + Pop", "Monochrome". */
  color_theory: string;
  /** 👗 Fit Check — e.g. "Snatched", "Tailored", "Flowing". */
  fit_check: string;
  /** 🌡️ Weather Sync — e.g. "Perfect (Indoor / Mild Weather)". */
  weather_sync: string;
  /** Optional risk flag — only present when dress-code rules are stretched. */
  risk_flag?: string | null;
  /** Stylist verdict — 2-3 sentence punchy copy. */
  verdict: string;
}

export interface OutfitSuggestion {
  id: string;
  user_id: string;
  event_id: string;
  item_ids: string[];
  accessory_ids: string[];
  score: number;
  /** Short stylist verdict (legacy text field — same as card.verdict). */
  explanation?: string;
  /** Structured quick-glance card. Present on all v2.0+ suggestions. */
  card?: OutfitCard;
  user_rating?: number;
  generated_at: string;
}

export interface OutfitsResponse {
  event: Event;
  suggestions: OutfitSuggestion[];
  /** True when every returned outfit was already shown — wardrobe variety exhausted. */
  all_seen?: boolean;
  /**
   * Plain-English hints about missing item types that would unlock more outfit templates.
   * Empty array when the wardrobe already covers at least one full template family.
   */
  coverage_hints?: string[];
}

/**
 * Generate outfit suggestions for an event.
 *
 * @param previouslyShownIds  All suggestion IDs shown so far in this session
 *                            (accumulated across regenerates). Their combos are
 *                            soft-downranked so fresh looks surface first.
 * @param markAsBad           True only when user clicks "None of these work" —
 *                            writes user_rating=0 on unrated shown suggestions.
 *                            False for neutral "Show me more" (no ratings written).
 */
export async function generateOutfits(
  eventId: string,
  topN: number = 3,
  previouslyShownIds?: string[],
  markAsBad: boolean = false,
): Promise<OutfitsResponse> {
  const { data } = await api.post<OutfitsResponse>("/recommend/generate-outfits", {
    event_id: eventId,
    top_n: topN,
    mark_as_bad: markAsBad,
    ...(previouslyShownIds && previouslyShownIds.length > 0
      ? { previously_shown_ids: previouslyShownIds }
      : {}),
  });
  return data;
}

/** Reset all outfit feedback for occasions similar to the given event. */
export async function resetFeedback(eventId: string): Promise<void> {
  await api.post("/recommend/reset-feedback", { event_id: eventId });
}

/** Fetch previously generated suggestions for an event. */
export async function getSuggestions(eventId: string): Promise<OutfitSuggestion[]> {
  const { data } = await api.get<OutfitSuggestion[]>(`/recommend/suggestions/${eventId}`);
  return data;
}

// ── Feedback ──────────────────────────────────────────────────────────────

/** Submit a 1–5 star rating for an outfit. */
export async function rateOutfit(outfitId: string, rating: number): Promise<void> {
  await api.post("/feedback/rate-outfit", { outfit_id: outfitId, rating });
}

// ── Profile ──────────────────────────────────────────────────────────────

export default api;

export interface UserProfile {
  id: string;
  email: string;
  body_type?: string;
  height_cm?: number;
  weight_kg?: number;
  age_range?: string;
  complexion?: string;
  face_shape?: string;
  hairstyle?: string;
  photo_url?: string;
  ai_profile_photo_url?: string;
  ai_profile_analysis?: AIProfileAnalysis;
  ai_profile_analyzed_at?: string;
  is_pro: boolean;
}

export interface UpdateProfileRequest {
  body_type?: string;
  height_cm?: number;
  weight_kg?: number;
  age_range?: string;
  complexion?: string;
  face_shape?: string;
  hairstyle?: string;
}

export type ProfileAnalysisConfidence = "high" | "medium" | "low";

export interface ProfileTraitAnalysis {
  value?: string | null;
  confidence: ProfileAnalysisConfidence;
  reason: string;
}

export interface AIProfileAnalysis {
  source: string;
  face_shape: ProfileTraitAnalysis;
  body_type: ProfileTraitAnalysis;
  complexion: ProfileTraitAnalysis;
  hair_texture: ProfileTraitAnalysis;
  hair_length: ProfileTraitAnalysis;
}

export interface ProfilePhotoUploadResponse {
  photo_url: string;
}

export interface AIProfilePhotoUploadResponse {
  ai_profile_photo_url: string;
  ai_profile_analysis: AIProfileAnalysis;
  ai_profile_analyzed_at?: string;
}

export async function getProfile(): Promise<UserProfile> {
  const { data } = await api.get<UserProfile>("/profile/");
  return data;
}

export async function updateProfile(payload: UpdateProfileRequest): Promise<UserProfile> {
  const { data } = await api.put<UserProfile>("/profile/", payload);
  return data;
}

export async function uploadProfilePhoto(file: Blob, filename: string = "profile.jpg"): Promise<ProfilePhotoUploadResponse> {
  const form = new FormData();
  form.append("photo", file, filename);
  const { data } = await api.post<ProfilePhotoUploadResponse>("/profile/photo", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function uploadAIProfilePhoto(file: Blob, filename: string = "ai-profile.jpg"): Promise<AIProfilePhotoUploadResponse> {
  const form = new FormData();
  form.append("photo", file, filename);
  const { data } = await api.post<AIProfilePhotoUploadResponse>("/profile/ai-photo", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
