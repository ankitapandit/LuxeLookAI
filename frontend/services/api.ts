/**
 * services/api.ts — Centralised API client
 * ==========================================
 * All HTTP calls to the FastAPI backend go through this module.
 * Automatically attaches the JWT from localStorage to every request.
 */

import axios, { AxiosInstance } from "axios";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Axios instance ────────────────────────────────────────────────────────
const api: AxiosInstance = axios.create({ baseURL: BASE_URL });

/**
 * Request interceptor — inject the stored JWT as a Bearer token.
 * Called before every outgoing request.
 */
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("luxelook_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Auth ──────────────────────────────────────────────────────────────────

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user_id: string;
}

/** Register a new account. Stores the token on success. */
export async function signup(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/signup", { email, password });
  localStorage.setItem("luxelook_token", data.access_token);
  localStorage.setItem("luxelook_user_id", data.user_id);
  return data;
}

/** Log in with existing credentials. Stores the token on success. */
export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/login", { email, password });
  localStorage.setItem("luxelook_token", data.access_token);
  localStorage.setItem("luxelook_user_id", data.user_id);
  return data;
}

/** Clear auth state. */
export function logout() {
  localStorage.removeItem("luxelook_token");
  localStorage.removeItem("luxelook_user_id");
}

export function isLoggedIn(): boolean {
  return !!localStorage.getItem("luxelook_token");
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
  created_at: string;
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
  overrides?: { category?: string; color?: string; pattern?: string; season?: string; formality_label?: string }
): Promise<ClothingItem> {
  const form = new FormData();
  form.append("file", file);
  if (overrides?.category)        form.append("category",        overrides.category);
  if (overrides?.color)           form.append("color",           overrides.color);
  if (overrides?.pattern)         form.append("pattern",         overrides.pattern);
  if (overrides?.season)          form.append("season",          overrides.season);
  if (overrides?.formality_label) form.append("formality_label", overrides.formality_label);

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
  corrections: { category?: string; color?: string; pattern?: string; season?: string; formality_label?: string }
): Promise<ClothingItem> {
  const params = new URLSearchParams();
  if (corrections.category)        params.append("category",        corrections.category);
  if (corrections.color)           params.append("color",           corrections.color);
  if (corrections.pattern)         params.append("pattern",         corrections.pattern);
  if (corrections.season)          params.append("season",          corrections.season);
  if (corrections.formality_label) params.append("formality_label", corrections.formality_label);
  const { data } = await api.patch<ClothingItem>(`/clothing/item/${itemId}?${params}`);
  return data;
}

/** Fetch the user's full wardrobe. */
export async function getWardrobeItems(): Promise<ClothingItem[]> {
  const { data } = await api.get<ClothingItem[]>("/clothing/items");
  return data;
}

/** Delete an item by ID. */
export async function deleteClothingItem(itemId: string): Promise<void> {
  await api.delete(`/clothing/item/${itemId}`);
}

// ── Events ────────────────────────────────────────────────────────────────

export interface Event {
  id: string;
  user_id: string;
  raw_text: string;
  occasion_type: string;
  formality_level: number;
  temperature_context?: string;
  setting?: string;
  created_at: string;
}

/** Create a new event from a free-text description. */
export async function createEvent(rawText: string): Promise<Event> {
  const { data } = await api.post<Event>("/events/create-event", { raw_text: rawText });
  return data;
}

/** Fetch all events for the current user, newest first. */
export async function getEvents(): Promise<Event[]> {
  const { data } = await api.get<Event[]>("/events/list");
  return data;
}

// ── Recommendations ───────────────────────────────────────────────────────

export interface OutfitSuggestion {
  id: string;
  user_id: string;
  event_id: string;
  item_ids: string[];
  accessory_ids: string[];
  score: number;
  explanation: string;
  user_rating?: number;
  generated_at: string;
}

export interface OutfitsResponse {
  event: Event;
  suggestions: OutfitSuggestion[];
}

/** Generate outfit suggestions for an event. */
export async function generateOutfits(
  eventId: string,
  topN: number = 3
): Promise<OutfitsResponse> {
  const { data } = await api.post<OutfitsResponse>("/recommend/generate-outfits", {
    event_id: eventId,
    top_n: topN,
  });
  return data;
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
  complexion?: string;
  face_shape?: string;
  hairstyle?: string;
  photo_url?: string;
  is_pro: boolean;
}

export interface UpdateProfileRequest {
  body_type?: string;
  height_cm?: number;
  weight_kg?: number;
  complexion?: string;
  face_shape?: string;
  hairstyle?: string;
}

export async function getProfile(): Promise<UserProfile> {
  const { data } = await api.get<UserProfile>("/profile/");
  return data;
}

export async function updateProfile(payload: UpdateProfileRequest): Promise<UserProfile> {
  const { data } = await api.put<UserProfile>("/profile/", payload);
  return data;
}
