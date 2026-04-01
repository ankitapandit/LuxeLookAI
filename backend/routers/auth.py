"""
routers/auth.py — Authentication endpoints
===========================================
POST /auth/signup  — create a new user
POST /auth/login   — authenticate and receive a JWT

Supports two modes (controlled by USE_MOCK_AUTH in .env):
  - Mock mode  (USE_MOCK_AUTH=true):  uses an in-memory store, no Supabase needed.
                                       Great for local dev before you have credentials.
  - Real mode  (USE_MOCK_AUTH=false): delegates to Supabase Auth.
"""

from fastapi import APIRouter, HTTPException, status
from models.schemas import SignupRequest, LoginRequest, AuthResponse
from utils.auth import create_access_token
from config import get_settings

router = APIRouter()


def _signup_mock(email: str, password: str) -> str:
    """Use the in-memory mock store — no external services required."""
    from utils.mock_auth_store import mock_signup
    from utils.mock_db_store import insert

    user_id = mock_signup(email, password)
    insert("users", {
        "id": user_id,
        "email": email.lower().strip(),
        "is_pro": False,
    })
    return user_id


def _signup_real(email: str, password: str) -> str:
    """Use Supabase Auth — requires valid Supabase credentials in .env."""
    from utils.db import get_supabase
    from config import get_settings
    s = get_settings()
    db = get_supabase()
    result = db.auth.sign_up({"email": email, "password": password})
    user_id = result.user.id
    # Insert into public users table to satisfy foreign key
    db.table("users").upsert({"id": user_id, "email": email}, on_conflict="id").execute()
    return user_id


def _login_mock(email: str, password: str) -> str:
    from utils.mock_auth_store import mock_login
    return mock_login(email, password)


def _login_real(email: str, password: str) -> str:
    from utils.db import get_supabase
    db = get_supabase()
    result = db.auth.sign_in_with_password({"email": email, "password": password})
    return result.user.id


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest):
    """
    Register a new user.
    In mock mode: instant, no network call.
    In real mode: creates account in Supabase Auth.
    """
    settings = get_settings()
    try:
        if settings.use_mock_auth:
            user_id = _signup_mock(payload.email, payload.password)
        else:
            user_id = _signup_real(payload.email, payload.password)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    token = create_access_token(user_id)
    return AuthResponse(access_token=token, user_id=user_id)


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest):
    """
    Authenticate an existing user and return a JWT.
    In mock mode: checks the in-memory store.
    In real mode: validates against Supabase Auth.
    """
    settings = get_settings()
    try:
        if settings.use_mock_auth:
            user_id = _login_mock(payload.email, payload.password)
        else:
            user_id = _login_real(payload.email, payload.password)
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))

    token = create_access_token(user_id)
    return AuthResponse(access_token=token, user_id=user_id)
