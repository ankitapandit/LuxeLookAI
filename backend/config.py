"""
config.py — Centralised environment variable loading
=====================================================
All secrets and service URLs are read from a .env file.
Never hard-code credentials in source code.
"""

import os
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── Supabase ─────────────────────────────────────────────────────────────
    supabase_url: str = "https://your-project.supabase.co"
    supabase_anon_key: str = "your-anon-key"
    supabase_service_key: str = "your-service-role-key"

    # ── OpenAI ───────────────────────────────────────────────────────────────
    openai_api_key: str = "sk-your-openai-key"

    # ── JWT ──────────────────────────────────────────────────────────────────
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24  # 24 hours

    # ── Feature flags ────────────────────────────────────────────────────────
    # Set to True once real keys are configured
    use_mock_ai: bool = True

    # Bypass Supabase Auth entirely — uses an in-memory store instead.
    # Perfect for local development before Supabase is configured.
    # Set to false once you have real Supabase credentials in .env
    use_mock_auth: bool = True

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    """Return a cached Settings instance (only reads .env once)."""
    return Settings()
