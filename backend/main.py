"""
LuxeLook AI — FastAPI Backend Entry Point
==========================================
Registers all route groups and configures CORS for the Next.js frontend.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import auth, clothing, events, recommendations, feedback, profile

# ── App Initialization ──────────────────────────────────────────────────────
app = FastAPI(
    title="LuxeLook AI",
    description="AI-powered personal stylist backend",
    version="1.0.0",
)

# ── CORS ─────────────────────────────────────────────────────────────────────
# Allow the Next.js dev server (port 3000) to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Route Registration ────────────────────────────────────────────────────────
app.include_router(auth.router,            prefix="/auth",        tags=["Auth"])
app.include_router(clothing.router,        prefix="/clothing",    tags=["Clothing"])
app.include_router(events.router,          prefix="/events",      tags=["Events"])
app.include_router(recommendations.router, prefix="/recommend",   tags=["Recommendations"])
app.include_router(feedback.router,        prefix="/feedback",    tags=["Feedback"])
app.include_router(profile.router, prefix="/profile", tags=["profile"])

@app.get("/health")
def health_check():
    """Simple liveness probe — confirm API is reachable."""
    return {"status": "ok", "service": "luxelook-ai"}
