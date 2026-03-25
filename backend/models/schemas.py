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

from pydantic import BaseModel, EmailStr


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

class UserProfile(BaseModel):
    id: UUID
    email: str
    body_type: Optional[str] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    complexion: Optional[str] = None
    face_shape: Optional[str] = None
    hairstyle: Optional[str] = None
    preferred_styles: Optional[dict] = None
    disliked_styles: Optional[dict] = None
    photo_url: Optional[str] = None
    is_pro: bool = False


class UpdateProfileRequest(BaseModel):
    body_type:  Optional[str]   = None
    height_cm:     Optional[float] = None
    weight_kg:     Optional[float] = None
    complexion: Optional[str]   = None
    face_shape: Optional[str]   = None
    hairstyle:  Optional[str]   = None


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


class ClothingItem(ClothingItemCreate):
    id: UUID
    user_id: UUID
    image_url: str
    embedding_vector: Optional[List[float]] = None  # 512-dim CLIP vector
    created_at: datetime

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
    created_at: datetime

    class Config:
        from_attributes = True


# ── Outfit Suggestions ────────────────────────────────────────────────────────

class OutfitSuggestion(BaseModel):
    id: UUID
    user_id: UUID
    event_id: UUID
    item_ids: List[UUID]              # core garments (top + bottom or dress, shoes)
    accessory_ids: Optional[List[UUID]] = []  # max 2 accessories
    score: float                      # 0.0 → 1.0 composite ranking score
    explanation: str                  # LLM-generated human-readable rationale
    user_rating: Optional[int] = None # 1-5 after feedback
    generated_at: datetime

    class Config:
        from_attributes = True


class GenerateOutfitsRequest(BaseModel):
    event_id: UUID
    top_n: int = 3  # how many outfit suggestions to return


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
