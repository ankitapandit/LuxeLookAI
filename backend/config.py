"""
config.py — Centralised environment variable loading
=====================================================
All secrets and service URLs are read from a .env file.
Never hard-code credentials in source code.
"""

from functools import lru_cache
from pydantic_settings import BaseSettings
from pydantic import ConfigDict


class Settings(BaseSettings):
    model_config = ConfigDict(
        env_file=".env",
        extra="ignore",
    )

    # ── Supabase ─────────────────────────────────────────────────────────────
    supabase_url: str = "https://your-project.supabase.co"
    supabase_anon_key: str = "your-anon-key"
    supabase_service_key: str = "your-service-role-key"

    # ── OpenAI ───────────────────────────────────────────────────────────────
    openai_api_key: str = "sk-your-openai-key"

    # ── Pexels ───────────────────────────────────────────────────────────────
    pexels_api_key: str = ""

    # ── Kaggle (used by scripts/build_trend_calendar.py — not needed at runtime) ──
    kaggle_username: str = ""
    kaggle_key: str = ""

    # ── Discover search provider ─────────────────────────────────────────────
    # auto: prefers a configured real provider, else falls back to mock
    # pexels: uses the Pexels search API if the key exists
    # mock: deterministic placeholder results for local development
    discover_search_provider: str = "auto"
    discover_embedded_worker: bool = True
    discover_worker_poll_seconds: float = 3.0

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

@lru_cache()
def get_settings() -> Settings:
    """Return a cached Settings instance (only reads .env once)."""
    return Settings()
