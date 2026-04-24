"""
LuxeLook AI — FastAPI Backend Entry Point
==========================================
Registers all route groups and configures CORS for the Next.js frontend.
"""

import logging
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from routers import activity, auth, batch_upload, clothing, discover, event, recommendations, feedback, profile
from workers.discover_worker import run_loop


logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

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
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=(
        r"^http://("
        r"localhost|"
        r"127\.0\.0\.1|"
        r"10(?:\.\d{1,3}){3}|"
        r"192\.168(?:\.\d{1,3}){2}|"
        r"172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}"
        r")(:\d+)?$"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Route Registration ────────────────────────────────────────────────────────
app.include_router(auth.router,            prefix="/auth",        tags=["Auth"])
app.include_router(activity.router,        prefix="/activity",    tags=["Activity"])
app.include_router(clothing.router,        prefix="/clothing",    tags=["Clothing"])
app.include_router(discover.router,        prefix="/discover",    tags=["Discover"])
app.include_router(event.router,           prefix="/event",       tags=["Event"])
app.include_router(recommendations.router, prefix="/recommend",   tags=["Recommendations"])
app.include_router(feedback.router,        prefix="/feedback",    tags=["Feedback"])
app.include_router(profile.router,       prefix="/profile",       tags=["profile"])
app.include_router(batch_upload.router,  prefix="/batch-upload",  tags=["BatchUpload"])

_discover_worker_thread: threading.Thread | None = None
_discover_worker_stop: threading.Event | None = None


@app.on_event("startup")
def start_embedded_discover_worker() -> None:
    global _discover_worker_thread, _discover_worker_stop

    settings = get_settings()
    if not settings.discover_embedded_worker:
        return
    if _discover_worker_thread and _discover_worker_thread.is_alive():
        return

    _discover_worker_stop = threading.Event()
    _discover_worker_thread = threading.Thread(
        target=run_loop,
        kwargs={
            "poll_seconds": settings.discover_worker_poll_seconds,
            "stop_event": _discover_worker_stop,
            "worker_id_suffix": "discover-embedded",
        },
        daemon=True,
        name="discover-embedded-worker",
    )
    _discover_worker_thread.start()


@app.on_event("shutdown")
def stop_embedded_discover_worker() -> None:
    global _discover_worker_thread, _discover_worker_stop

    if _discover_worker_stop:
        _discover_worker_stop.set()
    if _discover_worker_thread and _discover_worker_thread.is_alive():
        _discover_worker_thread.join(timeout=2.0)
    _discover_worker_thread = None
    _discover_worker_stop = None

@app.get("/health")
def health_check():
    """Simple liveness probe — confirm API is reachable."""
    return {"status": "ok", "service": "luxelook-ai"}
