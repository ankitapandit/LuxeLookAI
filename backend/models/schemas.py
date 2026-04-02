"""
models/schemas.py — Pydantic request/response schemas
======================================================
These models validate all API input and serialise all API output.
Each schema mirrors the database tables defined in the spec.
"""

from __future__ import annotations
from datetime import datetime
from typing import List, Optional
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
    body_type: Optional[str] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    complexion: Optional[str] = None
    face_shape: Optional[str] = None
    hairstyle: Optional[str] = None
    age_range: Optional[str] = None
    preferred_styles: Optional[dict] = None
    disliked_styles: Optional[dict] = None
    photo_url: Optional[str] = None
    ai_profile_photo_url: Optional[str] = None
    ai_profile_analysis: Optional[AIProfileAnalysis] = None
    ai_profile_analyzed_at: Optional[datetime] = None
    is_pro: bool = False


class UpdateProfileRequest(BaseModel):
    body_type:  Optional[str]   = None
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
    category: str                         # e.g. "tops", "bottoms", "shoes"
    item_type: str                        # "core_garment" | "footwear" | "outerwear" | "accessory"
    accessory_subtype: Optional[str] = None  # jewelry | bag | belt | scarf | other
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
    embedding_vector: Optional[List[float]] = None  # 512-dim CLIP vector
    created_at: datetime
    descriptors: Optional[dict] = {}

    class Config:
        from_attributes = True


# ── Events ────────────────────────────────────────────────────────────────────

class EventCreate(BaseModel):
    """User submits free-text occasion description."""
    raw_text: str  # e.g. "Black-tie dinner at the Met this Friday"


class Event(BaseModel):
    id: UUID
    user_id: UUID
    raw_text: str
    occasion_type: str       # formal | casual | party | business | etc.
    formality_level: float   # 0.0 → 1.0
    temperature_context: Optional[str] = None
    setting: Optional[str] = None
    event_tokens: Optional[List[str]] = []  # semantic tags: ["dinner","rooftop","evening",…]
    created_at: datetime

    class Config:
        from_attributes = True


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

    # Stylist verdict — 2-3 sentence punchy copy in Zara/TikTok language
    verdict: str


class OutfitSuggestion(BaseModel):
    id: UUID
    user_id: UUID
    event_id: UUID
    item_ids: List[UUID]                    # core garments (top + bottom or dress, shoes)
    accessory_ids: Optional[List[UUID]] = []  # max 2 accessories
    score: float                            # 0.0 → 1.0 composite ranking score
    explanation: Optional[str] = None      # legacy field — now holds the short stylist verdict
    card: Optional[OutfitCard] = None      # structured quick-glance card (v2.0+)
    user_rating: Optional[int] = None      # 1–5 star rating from user feedback
    generated_at: datetime

    class Config:
        from_attributes = True


class GenerateOutfitsRequest(BaseModel):
    event_id: UUID
    top_n: int = 3
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


# ── Feedback ─────────────────────────────────────────────────────────────────

class FeedbackRequest(BaseModel):
    outfit_id: UUID
    rating: int  # 1–5


class FeedbackResponse(BaseModel):
    outfit_id: UUID
    rating: int
    message: str
