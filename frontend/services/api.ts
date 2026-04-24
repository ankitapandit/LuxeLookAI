/**
 * services/api.ts — Centralised API client
 * ==========================================
 * All HTTP calls to the FastAPI backend go through this module.
 * Automatically attaches the JWT from localStorage to every request.
 */

import axios, { AxiosInstance } from "axios";

const CONFIGURED_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const AUTH_TOKEN_KEY = "luxelook_token";
export const AUTH_USER_ID_KEY = "luxelook_user_id";
export const AUTH_CHANGED_EVENT = "luxelook-auth-changed";

function resolveBaseUrl(): string {
  if (!isBrowser()) {
    return CONFIGURED_BASE_URL;
  }

  try {
    const url = new URL(CONFIGURED_BASE_URL);
    const browserHost = window.location.hostname;
    const isConfiguredLocalHost = ["localhost", "127.0.0.1"].includes(url.hostname);
    const isBrowserLocalHost = ["localhost", "127.0.0.1"].includes(browserHost);

    if (isConfiguredLocalHost && !isBrowserLocalHost) {
      url.hostname = browserHost;
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return CONFIGURED_BASE_URL;
  }
}

export function getApiBaseUrl(): string {
  return resolveBaseUrl();
}

// ── Axios instance ────────────────────────────────────────────────────────
const api: AxiosInstance = axios.create({ baseURL: resolveBaseUrl() });

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
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (timezone) {
    config.headers["X-Client-Timezone"] = timezone;
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

export interface PageVisitStartRequest {
  session_id: string;
  page_key: string;
  referrer_page_key?: string | null;
  source?: string;
  context_json?: Record<string, unknown>;
  entered_at?: string;
}

export interface PageVisitStartResponse {
  visit_id: string;
  entered_at: string;
}

export interface PageVisitEndRequest {
  visit_id: string;
  left_at?: string;
  duration_ms?: number;
}

export interface PageVisitEndResponse {
  status: string;
  visit_id: string;
  left_at: string;
  duration_ms?: number | null;
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

export async function startPageVisit(payload: PageVisitStartRequest): Promise<PageVisitStartResponse> {
  const { data } = await api.post<PageVisitStartResponse>("/activity/page-visits/start", payload);
  return data;
}

export async function endPageVisit(payload: PageVisitEndRequest): Promise<PageVisitEndResponse> {
  const { data } = await api.post<PageVisitEndResponse>("/activity/page-visits/end", payload);
  return data;
}

export function endPageVisitKeepalive(payload: PageVisitEndRequest): boolean {
  if (!isBrowser()) return false;
  const { token } = getStoredAuth();
  if (!token) return false;

  try {
    fetch(`${getApiBaseUrl()}/activity/page-visits/end`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Best-effort logging only.
    });
    return true;
  } catch {
    return false;
  }
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
  is_active?: boolean;
  is_archived?: boolean;
  archived_on?: string | null;
  deleted_at?: string | null;
  verification_status?: "pending" | "verified" | "rejected";
  ingestion_source?: string | null;
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
  duplicate?: {
    id: string;
    category: string;
    color: string;
    image_url: string;
    score: number;
    is_active: boolean;
    is_archived: boolean;
  } | null;
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

export async function getWardrobeMediaStatus(itemIds: string[], includeUnverified: boolean = false): Promise<ClothingItem[]> {
  if (!itemIds.length) return [];
  const params = new URLSearchParams();
  itemIds.forEach((id) => params.append("item_ids", id));
  if (includeUnverified) params.append("include_unverified", "true");
  const { data } = await api.get<ClothingItem[]>(`/clothing/items/media-status?${params.toString()}`);
  return data;
}

/**
 * Step 1 of the two-step upload flow.
 * Sends the image to the AI tagger and returns predicted tags.
 * Nothing is saved — this is preview-only so the user can review and correct.
 */
export async function tagPreview(file: File, categoryOverride?: string): Promise<TagPreview> {
  const form = new FormData();
  form.append("file", file);
  if (categoryOverride) form.append("category_override", categoryOverride);
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

/** Permanently delete an item from the archive/trash view. */
export async function purgeArchivedClothingItem(itemId: string): Promise<void> {
  await api.delete(`/clothing/item/${itemId}/purge`);
}

/** Permanently delete any wardrobe item immediately. */
export async function deleteClothingItemForever(itemId: string): Promise<void> {
  await api.delete(`/clothing/item/${itemId}/permanent`);
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
  raw_text_json?: Record<string, unknown> | null;
  occasion_type: string;
  formality_level: number;
  temperature_context?: string;
  setting?: string;
  event_tokens?: string[];
  created_at: string;
}

/** Create a new event from a human-readable summary plus structured details. */
export async function createEvent(rawText: string, rawTextJson?: Record<string, unknown> | null): Promise<Event> {
  const { data } = await api.post<Event>("/event/create-event", {
    raw_text: rawText,
    raw_text_json: rawTextJson ?? undefined,
  });
  return data;
}

/** Fetch all events for the current user, newest first. */
export async function getEvents(): Promise<Event[]> {
  const { data } = await api.get<Event[]>("/event/list");
  return data;
}

// ── Discover ─────────────────────────────────────────────────────────────

export interface DiscoverProfileContext {
  gender: string;
  ethnicity: string;
  body_type?: string | null;
  complexion?: string | null;
  age_range?: string | null;
  hairstyle?: string | null;
  season?: string | null;
}

export interface DiscoverCard {
  id: string;
  source_url: string;
  normalized_url: string;
  image_url: string;
  thumbnail_url?: string | null;
  display_image_url?: string | null;
  source_domain?: string | null;
  title: string;
  summary: string;
  source_note?: string | null;
  style_tags: string[];
  style_ids: string[];
  person_count: number;
  is_single_person: boolean;
  search_query?: string | null;
  analysis?: Record<string, unknown> | null;
}

export interface DiscoverFeedResponse {
  seed_query: string;
  profile_context: DiscoverProfileContext;
  cards: DiscoverCard[];
  ignored_url_count: number;
  total_interactions: number;
  daily_interactions: number;
  daily_limit: number;
  preference_rows: DiscoverPreferenceRow[];
  style_seed?: { preferred: string[]; disliked: string[] } | null;
  warming_up?: boolean;
  queued_job_id?: string | null;
}

export type DiscoverAction = "love" | "like" | "dislike";

export interface DiscoverInteractionRequest {
  action: DiscoverAction;
  card_id: string;
  source_url: string;
  normalized_url?: string;
  image_url: string;
  thumbnail_url?: string | null;
  source_domain?: string | null;
  title: string;
  summary?: string | null;
  search_query?: string | null;
  style_tags?: string[];
  style_ids?: string[];
  person_count?: number;
  is_single_person?: boolean;
  analysis?: Record<string, unknown> | null;
  interaction_index?: number;
  commit_preferences?: boolean;
}

export interface DiscoverPreferenceRow {
  style_id: string;
  style_key: string;
  label: string;
  dimension: string;
  score: number;
  confidence: number;
  exposure_count: number;
  love_count: number;
  like_count: number;
  dislike_count: number;
  positive_count: number;
  negative_count: number;
  status: string;
  last_interaction_at?: string | null;
}

export interface DiscoverInteractionResponse {
  status: string;
  ignored_url?: string | null;
  commit_triggered: boolean;
  total_interactions: number;
  daily_interactions: number;
  daily_limit: number;
  message?: string | null;
  preference_summary?: Record<string, unknown> | null;
  updated_preferences: DiscoverPreferenceRow[];
  queued_job_id?: string | null;
  queued_job_status?: string | null;
}

export interface DiscoverJobResponse {
  id: string;
  job_type: string;
  status: string;
  result?: Record<string, unknown> | null;
  last_error?: string | null;
  attempts: number;
  max_attempts: number;
  locked_at?: string | null;
  updated_at?: string | null;
}

export interface DiscoverStatusResponse {
  total_interactions: number;
  daily_interactions: number;
  daily_limit: number;
  preference_rows: DiscoverPreferenceRow[];
  queued_count: number;
  running_count: number;
  failed_count: number;
  latest_seed_job?: DiscoverJobResponse | null;
  latest_refresh_job?: DiscoverJobResponse | null;
  latest_failed_job?: DiscoverJobResponse | null;
}

export interface DiscoverRetrySeedResponse {
  status: string;
  queued_job_id: string;
  queued_job_status: string;
  seed_query: string;
}

export interface DiscoverPrewarmResponse {
  status: string;
  seed_query: string;
  ready_count: number;
  queued_job_id?: string | null;
  queued_job_status?: string | null;
}

export async function getDiscoverFeed(limit: number = 6): Promise<DiscoverFeedResponse> {
  const { data } = await api.get<DiscoverFeedResponse>("/discover/feed", { params: { limit } });
  return data;
}

export async function recordDiscoverInteraction(payload: DiscoverInteractionRequest): Promise<DiscoverInteractionResponse> {
  const { data } = await api.post<DiscoverInteractionResponse>("/discover/interaction", payload);
  return data;
}

export async function recomputeDiscoverPreferences(): Promise<DiscoverInteractionResponse> {
  const { data } = await api.post<DiscoverInteractionResponse>("/discover/recompute");
  return data;
}

export async function getDiscoverJobStatus(jobId: string): Promise<DiscoverJobResponse> {
  const { data } = await api.get<DiscoverJobResponse>(`/discover/jobs/${jobId}`);
  return data;
}

export async function getDiscoverStatus(): Promise<DiscoverStatusResponse> {
  const { data } = await api.get<DiscoverStatusResponse>("/discover/status");
  return data;
}

export async function retryDiscoverSeed(): Promise<DiscoverRetrySeedResponse> {
  const { data } = await api.post<DiscoverRetrySeedResponse>("/discover/retry-seed");
  return data;
}

export async function prewarmDiscover(minimumReady: number = 6): Promise<DiscoverPrewarmResponse> {
  const { data } = await api.post<DiscoverPrewarmResponse>("/discover/prewarm", null, {
    params: { minimum_ready: minimumReady },
  });
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
  /**
   * Multi-dimensional event alignment score as a rounded percentage (0–100).
   * Combines dress_code, mood, time_of_day, weather and purpose dims.
   * Shown as the primary "Event Fit" badge on outfit cards (v2.5+).
   */
  event_fit_pct?: number;
  /** Legacy field retained for compatibility; no longer shown in the UI. */
  verdict?: string;
}

export interface OutfitSuggestion {
  id: string;
  user_id: string;
  event_id: string;
  item_ids: string[];
  accessory_ids: string[];
  score: number;
  /** Legacy text field retained for compatibility. */
  explanation?: string;
  /** Structured quick-glance card. Present on all v2.0+ suggestions. */
  card?: OutfitCard;
  user_rating?: number;
  generated_at: string;
}

export interface StyleDirectionPiece {
  label: string;
  value: string;
  /** Pexels image URL for wearable pieces; null for hair/makeup/etc. */
  image_url?: string | null;
}

export interface StyleDirectionOption {
  name: string;
  emoji: string;
  pieces: StyleDirectionPiece[];
  why: string;
  tip: string;
}

export interface StyleDirectionData {
  options: StyleDirectionOption[];
}

export interface OutfitsResponse {
  event: Event;
  suggestions: OutfitSuggestion[];
  /** True when every returned outfit was already shown — wardrobe variety exhausted. */
  all_seen?: boolean;
  /** Optional mode flag for anchor-item styling flows. */
  status?: "moodboard" | "text_only" | "partial" | string;
  /** LLM-authored outfit options built around the anchor item. */
  style_direction?: StyleDirectionData;
  /** Suggested missing items or wardrobe gaps when no full outfit can be formed. */
  missing_items?: string[];
  /** Anchor item echoed back for convenience in style-item flows. */
  anchor_item?: ClothingItem;
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
  anchorItemId?: string,
): Promise<OutfitsResponse> {
  const { data } = await api.post<OutfitsResponse>("/recommend/generate-outfits", {
    event_id: eventId,
    top_n: topN,
    mark_as_bad: markAsBad,
    ...(anchorItemId ? { anchor_item_id: anchorItemId } : {}),
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
  gender?: string;
  ethnicity?: string;
  body_type?: string;
  shoulders?: string;
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
  gender?: string;
  ethnicity?: string;
  body_type?: string;
  shoulders?: string;
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

// ── Batch Upload ──────────────────────────────────────────────────────────────

export type BatchSessionStatus =
  | "queued"
  | "uploading"
  | "processing"
  | "awaiting_verification"
  | "completed"
  | "completed_with_errors";

export type BatchItemStatus =
  | "queued"
  | "uploaded"
  | "tagging"
  | "tagged"
  | "awaiting_verification"
  | "verified"
  | "rejected"
  | "failed";

export interface BatchSession {
  id: string;
  user_id: string;
  status: BatchSessionStatus;
  total_count: number;
  uploaded_count: number;
  processed_count: number;
  awaiting_verification_count: number;
  verified_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export interface BatchItem {
  id: string;
  session_id: string;
  user_id: string;
  file_name?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  cutout_url?: string | null;
  status: BatchItemStatus;
  error_message?: string | null;
  clothing_item_id?: string | null;
  created_at: string;
  updated_at: string;
  verified_at?: string | null;
}

export interface BatchSessionWithItems extends BatchSession {
  items: BatchItem[];
}

function debugBatchUploadApi(event: string, details?: Record<string, unknown>) {
  if (details) console.debug(`[BatchUpload][API] ${event}`, details);
  else console.debug(`[BatchUpload][API] ${event}`);
}

/** Create a new batch upload session before uploading any images. */
export async function createBatchUploadSession(totalCount: number): Promise<BatchSession> {
  debugBatchUploadApi("create_session:start", { totalCount });
  const { data } = await api.post<BatchSession>("/batch-upload/session", {
    total_count: totalCount,
  });
  debugBatchUploadApi("create_session:success", { sessionId: data.id, status: data.status, totalCount: data.total_count });
  return data;
}

/**
 * Upload a single image into an existing batch session.
 * Returns the queued batch item immediately; tagging runs in the background.
 * Poll getBatchUploadSession() to track progress.
 */
export async function uploadBatchItem(sessionId: string, file: File): Promise<BatchItem> {
  debugBatchUploadApi("upload_item:start", { sessionId, filename: file.name, size: file.size });
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<BatchItem>(
    `/batch-upload/session/${sessionId}/items`,
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  debugBatchUploadApi("upload_item:success", { sessionId, itemId: data.id, status: data.status, filename: file.name });
  return data;
}

/** Fetch session detail including all item rows. */
export async function getBatchUploadSession(sessionId: string): Promise<BatchSessionWithItems> {
  const { data } = await api.get<BatchSessionWithItems>(`/batch-upload/session/${sessionId}`);
  debugBatchUploadApi("get_session:success", {
    sessionId,
    status: data.status,
    itemCount: data.items.length,
    awaiting: data.awaiting_verification_count,
    verified: data.verified_count,
    failed: data.failed_count,
  });
  return data;
}

/** List the user's recent batch sessions (newest first). */
export async function listBatchUploadSessions(limit = 20): Promise<BatchSession[]> {
  const { data } = await api.get<BatchSession[]>("/batch-upload/sessions", { params: { limit } });
  debugBatchUploadApi("list_sessions:success", { limit, count: data.length });
  return data;
}

/** Mark a batch item as verified. Updates the linked clothing item's trust status. */
export async function verifyBatchUploadItem(itemId: string): Promise<{ item_id: string; status: string; clothing_item_id?: string | null }> {
  debugBatchUploadApi("verify_item:start", { itemId });
  const { data } = await api.post(`/batch-upload/items/${itemId}/verify`);
  debugBatchUploadApi("verify_item:success", data as Record<string, unknown>);
  return data;
}

/** Mark a batch item as rejected. */
export async function rejectBatchUploadItem(itemId: string): Promise<{ item_id: string; status: string }> {
  debugBatchUploadApi("reject_item:start", { itemId });
  const { data } = await api.post(`/batch-upload/items/${itemId}/reject`);
  debugBatchUploadApi("reject_item:success", data as Record<string, unknown>);
  return data;
}
