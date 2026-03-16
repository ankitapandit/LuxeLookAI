"""
utils/mock_auth_store.py — In-memory auth for local development
================================================================
When USE_MOCK_AUTH=true, signup/login work with zero external services.
Users are stored in a plain Python dict (lives only while the server runs).

This means:
  - No Supabase account needed to get started
  - Restart the server → users are cleared (expected in dev)
  - Switch to USE_MOCK_AUTH=false once you have real Supabase credentials

NEVER use this in production.
"""

import hashlib
import uuid
import logging
from typing import Optional, Dict

logger = logging.getLogger(__name__)

# In-memory store: { email -> { user_id, hashed_password } }
_users: Dict[str, dict] = {}


def _hash_password(password: str) -> str:
    """Simple SHA-256 hash — good enough for local dev only."""
    return hashlib.sha256(password.encode()).hexdigest()


def mock_signup(email: str, password: str) -> str:
    """
    Register a new mock user.
    Returns the user_id (UUID string).
    Raises ValueError if the email is already registered.
    """
    email = email.lower().strip()
    if email in _users:
        raise ValueError(f"Email '{email}' is already registered.")

    user_id = str(uuid.uuid4())
    _users[email] = {
        "user_id":         user_id,
        "hashed_password": _hash_password(password),
    }
    logger.info(f"[MockAuth] User registered: {email} → {user_id}")
    return user_id


def mock_login(email: str, password: str) -> str:
    """
    Authenticate an existing mock user.
    Returns the user_id on success.
    Raises ValueError on wrong email or password.
    """
    email = email.lower().strip()
    record = _users.get(email)

    if not record:
        raise ValueError("No account found with that email.")
    if record["hashed_password"] != _hash_password(password):
        raise ValueError("Incorrect password.")

    logger.info(f"[MockAuth] Login OK: {email}")
    return record["user_id"]
