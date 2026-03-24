"""
utils/auth.py — JWT helpers and FastAPI dependency
====================================================
create_access_token  — signs a JWT for a user
get_current_user_id  — FastAPI dependency that validates Bearer tokens
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from config import get_settings

# HTTPBearer extracts the token from the "Authorization: Bearer <token>" header
bearer_scheme = HTTPBearer()


def create_access_token(user_id: str) -> str:
    """
    Sign a JWT containing the user's UUID.
    Expiry is controlled by settings.jwt_expire_minutes.
    """
    settings = get_settings()
    payload = {
        "sub": user_id,
        "exp": datetime.utcnow() + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    """
    FastAPI dependency — decodes JWT and returns the user_id (UUID string).
    Raises 401 if token is missing, expired, or tampered with.
    """
    settings = get_settings()
    token = credentials.credentials

    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        user_id: Optional[str] = payload.get("sub")

        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail="Invalid token payload")
        return user_id
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalid or expired",
        )
