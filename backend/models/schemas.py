"""
models/schemas.py — Pydantic request/response schemas
======================================================
These models validate all API input and serialise all API output.
Each schema mirrors the database tables defined in the spec.
"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Dict, List, Optional, Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


# ── Auth ─────────────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str


# ── Users ────────────────────────────────────────────────────────────────────

class ProfileTraitAnalysis(BaseModel):
    value: Optional[str] = None
    confidence: str = "low"
    reason: str = ""


class AIProfileAnalysis(BaseModel):
    source: str = "ai_profile_photo"
    face_shape: ProfileTraitAnalysis = Field(default_factory=ProfileTraitAnalysis)
    body_type: ProfileTraitAnalysis = Field(default_factory=ProfileTraitAnalysis)
    complexion: ProfileTraitAnalysis = Field(default_factory=ProfileTraitAnalysis)
    hair_texture: ProfileTraitAnalysis = Field(default_factory=ProfileTraitAnalysis)
    hair_length: ProfileTraitAnalysis = Field(default_factory=ProfileTraitAnalysis)

class UserProfile(BaseModel):
    id: UUID
    email: str
    gender: Optional[str] = "prefer_not_to_say"
    ethnicity: Optional[str] = "prefer_not_to_say"
    body_type: Optional[str] = None
    shoulders: Optional[str] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    complexion: Optional[str] = None
    face_shape: Optional[str] = None
    hairstyle: Optional[str] = None
    age_range: Optional[str] = None
    photo_url: Optional[str] = None
    ai_profile_photo_url: Optional[str] = None
    ai_profile_analysis: Optional[AIProfileAnalysis] = None
    ai_profile_analyzed_at: Optional[datetime] = None
    is_pro: bool = False


class UpdateProfileRequest(BaseModel):
    gender: Optional[str] = None
    ethnicity: Optional[str] = None
    body_type:  Optional[str]   = None
    shoulders:  Optional[str]   = None
    height_cm:     Optional[float] = None
    weight_kg:     Optional[float] = None
    complexion: Optional[str]   = None
    face_shape: Optional[str]   = None
    hairstyle:  Optional[str]   = None
    age_range:  Optional[str]   = None


class PhotoUploadResponse(BaseModel):
    photo_url: str


class AIProfilePhotoUploadResponse(BaseModel):
    ai_profile_photo_url: str
    ai_profile_analysis: AIProfileAnalysis
    ai_profile_analyzed_at: Optional[datetime] = None


# ── Clothing Items ────────────────────────────────────────────────────────────

class ClothingItemCreate(BaseModel):
    """Payload sent when uploading a new item (image handled separately)."""
    category: str                         # e.g. "tops", "bottoms", "shoes", "jewelry"
    item_type: str                        # "core_garment" | "footwear" | "outerwear" | "accessory"
    accessory_subtype: Optional[str] = None  # necklace | earrings | bracelet | ring | watch | bag | belt | scarf | hat | sunglasses | other
    color: Optional[str] = None
    pattern: Optional[str] = None         # stripes | plaid | floral | polka_dots | animal_print | geometric | abstract
    season: Optional[str] = None          # spring | summer | fall | winter | all
    formality_score: Optional[float] = None  # 0.0 (casual) → 1.0 (formal)
    descriptors: Optional[dict] = {}


class ClothingItem(ClothingItemCreate):
    id: UUID
    user_id: UUID
    image_url: str
    thumbnail_url: Optional[str] = None
    cutout_url: Optional[str] = None
    media_status: Optional[str] = None
    media_stage: Optional[str] = None
    media_error: Optional[str] = None
    media_updated_at: Optional[datetime] = None
    is_active: bool = True
    is_archived: bool = False
    archived_on: Optional[datetime] = None
    deleted_at: Optional[datetime] = None
    embedding_vector: Optional[List[float]] = None  # 512-dim CLIP vector
    created_at: datetime
    descriptors: Optional[dict] = {}

    class Config:
        from_attributes = True


# ── Events ────────────────────────────────────────────────────────────────────

class EventCreate(BaseModel):
    """User submits a human-readable event summary with optional structured context."""
    raw_text: str
    raw_text_json: Optional[dict] = None


class Event(BaseModel):
    id: UUID
    user_id: UUID
    raw_text: str
    raw_text_json: Optional[dict] = None
    occasion_type: str       # formal | casual | party | business | etc.
    formality_level: float   # 0.0 → 1.0
    temperature_context: Optional[str] = None
    setting: Optional[str] = None
    event_tokens: Optional[List[str]] = []  # semantic tags: ["dinner","rooftop","evening",…]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Discover ─────────────────────────────────────────────────────────────────

class DiscoverProfileContext(BaseModel):
    gender: str = "prefer_not_to_say"
    ethnicity: str = "prefer_not_to_say"
    body_type: Optional[str] = None
    shoulders: Optional[str] = None
    complexion: Optional[str] = None
    age_range: Optional[str] = None
    hairstyle: Optional[str] = None
    season: Optional[str] = None


class DiscoverCard(BaseModel):
    id: str
    source_url: str
    normalized_url: str
    image_url: str
    thumbnail_url: Optional[str] = None
    display_image_url: Optional[str] = None
    source_domain: Optional[str] = None
    title: str
    summary: str
    source_note: Optional[str] = None
    style_tags: List[str] = []
    style_ids: List[str] = []
    person_count: int = 1
    is_single_person: bool = True
    search_query: Optional[str] = None
    analysis: Optional[dict] = None


class DiscoverFeedResponse(BaseModel):
    seed_query: str
    profile_context: DiscoverProfileContext
    cards: List[DiscoverCard]
    ignored_url_count: int = 0
    total_interactions: int = 0
    daily_interactions: int = 0
    daily_limit: int = 10
    preference_rows: List[DiscoverPreferenceRow] = []
    style_seed: Optional[dict] = None
    warming_up: bool = False
    queued_job_id: Optional[str] = None


class DiscoverInteractionRequest(BaseModel):
    action: Literal["love", "like", "dislike"]
    card_id: str
    source_url: str
    normalized_url: Optional[str] = None
    image_url: str
    thumbnail_url: Optional[str] = None
    source_domain: Optional[str] = None
    title: str
    summary: Optional[str] = None
    search_query: Optional[str] = None
    style_tags: List[str] = []
    style_ids: List[str] = []
    person_count: int = 1
    is_single_person: bool = True
    analysis: Optional[dict] = None
    interaction_index: Optional[int] = None
    commit_preferences: bool = False


class DiscoverPreferenceRow(BaseModel):
    style_id: str
    style_key: str
    label: str
    dimension: str
    score: float
    confidence: float
    exposure_count: int
    love_count: int
    like_count: int
    dislike_count: int
    positive_count: int
    negative_count: int
    status: str
    last_interaction_at: Optional[str] = None


class DiscoverInteractionResponse(BaseModel):
    status: str = "recorded"
    ignored_url: Optional[str] = None
    commit_triggered: bool = False
    total_interactions: int = 0
    daily_interactions: int = 0
    daily_limit: int = 10
    message: Optional[str] = None
    preference_summary: Optional[dict] = None
    updated_preferences: List[DiscoverPreferenceRow] = []
    queued_job_id: Optional[str] = None
    queued_job_status: Optional[str] = None


class DiscoverJobResponse(BaseModel):
    id: str
    job_type: str
    status: str
    result: Optional[dict] = None
    last_error: Optional[str] = None
    attempts: int = 0
    max_attempts: int = 0
    locked_at: Optional[str] = None
    updated_at: Optional[str] = None


class DiscoverStatusResponse(BaseModel):
    total_interactions: int = 0
    daily_interactions: int = 0
    daily_limit: int = 10
    preference_rows: List[DiscoverPreferenceRow] = []
    queued_count: int = 0
    running_count: int = 0
    failed_count: int = 0
    latest_seed_job: Optional[DiscoverJobResponse] = None
    latest_refresh_job: Optional[DiscoverJobResponse] = None
    latest_failed_job: Optional[DiscoverJobResponse] = None


class DiscoverRetrySeedResponse(BaseModel):
    status: str = "queued"
    queued_job_id: str
    queued_job_status: str
    seed_query: str


class DiscoverPrewarmResponse(BaseModel):
    status: str
    seed_query: str
    ready_count: int = 0
    queued_job_id: Optional[str] = None
    queued_job_status: Optional[str] = None


class PageVisitStartRequest(BaseModel):
    session_id: str
    page_key: str
    referrer_page_key: Optional[str] = None
    source: str = "web"
    context_json: Dict[str, Any] = Field(default_factory=dict)
    entered_at: Optional[datetime] = None


class PageVisitStartResponse(BaseModel):
    visit_id: str
    entered_at: datetime


class PageVisitEndRequest(BaseModel):
    visit_id: str
    left_at: Optional[datetime] = None
    duration_ms: Optional[int] = None


class PageVisitEndResponse(BaseModel):
    status: str = "ok"
    visit_id: str
    left_at: datetime
    duration_ms: Optional[int] = None


# ── Outfit Suggestions ────────────────────────────────────────────────────────

class OutfitCard(BaseModel):
    """Structured 5-row at-a-glance card for an outfit suggestion (v2.0+).

    Each row maps to one attribute with a single human-readable value
    derived from the V2 scorer outputs — unique per outfit even within
    the same event.
    """

    # 🔥 Trend-o-meter — 1-5 stars + label (Outdated / Basic / Classic / Trendy / Statement)
    trend_stars: int   # 1–5
    trend_label: str   # e.g. "Trendy"
    look_title: Optional[str] = None

    # 💃 Vibe Check — "CoreVibe + Energy" e.g. "Elegant + Confident"
    vibe: str

    # 🎨 Color Theory — palette label e.g. "Neutral Base + Pop", "Monochrome"
    color_theory: str

    # 👗 Fit Check — e.g. "Snatched", "Tailored", "Flowing"
    fit_check: str

    # 🌡️ Weather Sync — "MatchLevel (Setting / TempLabel)" e.g. "Perfect (Indoor / Mild Weather)"
    weather_sync: str

    # Optional risk flag — only present when dress-code rules are stretched
    risk_flag: Optional[str] = None

    # Legacy field retained for compatibility; no longer shown in the UI.
    verdict: str = ""


class OutfitSuggestion(BaseModel):
    id: UUID
    user_id: UUID
    event_id: UUID
    item_ids: List[UUID]                    # core garments (top + bottom or dress, shoes)
    accessory_ids: Optional[List[UUID]] = []  # max 2 finishing pieces (accessories/jewelry)
    score: float                            # 0.0 → 1.0 composite ranking score
    explanation: Optional[str] = None      # legacy field retained for compatibility
    card: Optional[OutfitCard] = None      # structured quick-glance card (v2.0+)
    user_rating: Optional[int] = None      # 0–5 feedback; 0 = none of these work
    generated_at: datetime

    class Config:
        from_attributes = True


class GenerateOutfitsRequest(BaseModel):
    event_id: UUID
    top_n: int = 3
    anchor_item_id: Optional[UUID] = None
    # IDs of all suggestions shown so far in this session (accumulates across regenerates).
    # Their combos are soft-downranked so fresh looks always surface first.
    previously_shown_ids: Optional[List[str]] = []
    # True only when the user explicitly clicks "None of these work".
    # Marks unrated shown suggestions as user_rating=0 (negative signal).
    # False for neutral "Show me more" — no ratings are written.
    mark_as_bad: bool = False


class ResetFeedbackRequest(BaseModel):
    event_id: str  # used to identify occasion context (type + formality band)


class GenerateOutfitsResponse(BaseModel):
    event: Event
    suggestions: List[OutfitSuggestion]
    status: Optional[str] = None
    stylist_note: Optional[str] = None
    missing_items: Optional[List[str]] = None
    anchor_item: Optional[ClothingItem] = None


# ── Feedback ─────────────────────────────────────────────────────────────────

class FeedbackRequest(BaseModel):
    outfit_id: UUID
    rating: int  # 1–5


class FeedbackResponse(BaseModel):
    outfit_id: UUID
    rating: int
    message: str


# ── Batch Upload ──────────────────────────────────────────────────────────────

BatchSessionStatus = Literal[
    "queued", "uploading", "processing",
    "awaiting_verification", "completed", "completed_with_errors",
]

BatchItemStatus = Literal[
    "queued", "uploaded", "tagging", "tagged",
    "awaiting_verification", "verified", "rejected", "failed",
]


class CreateBatchSessionRequest(BaseModel):
    total_count: int = Field(..., ge=1, le=5)


class BatchSession(BaseModel):
    id: UUID
    user_id: UUID
    status: str
    total_count: int
    uploaded_count: int
    processed_count: int
    awaiting_verification_count: int
    verified_count: int
    failed_count: int
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class BatchItem(BaseModel):
    id: UUID
    session_id: UUID
    user_id: UUID
    file_name: Optional[str] = None
    image_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    cutout_url: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    clothing_item_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime
    verified_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class BatchSessionWithItems(BatchSession):
    items: List[BatchItem] = []


class VerifyBatchItemResponse(BaseModel):
    item_id: UUID
    status: str
    clothing_item_id: Optional[UUID] = None


class RejectBatchItemResponse(BaseModel):
    item_id: UUID
    status: str
