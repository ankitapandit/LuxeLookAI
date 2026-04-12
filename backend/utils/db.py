"""
utils/db.py — Supabase client factory
======================================
Returns a shared supabase-py client used across all service modules.
Uses the service-role key for backend operations (bypasses RLS).
"""

from functools import lru_cache
from supabase import create_client, Client
from config import get_settings


@lru_cache()
def get_supabase() -> Client:
    """
    Create and cache a single Supabase client for the lifetime of the process.
    The service-role key is used so the backend can read/write all rows
    regardless of Row Level Security policies.
    """
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_key)


def reset_supabase_client() -> None:
    """Drop the cached Supabase client so the next call gets a fresh connection."""
    get_supabase.cache_clear()
