"""
workers/discover_worker.py — Standalone Discover background worker
==================================================================
Runs the minimal durable job queue for Discover intelligence tasks.

Usage:
  cd backend
  python3 -m workers.discover_worker
"""

from __future__ import annotations

import logging
import socket
import threading
import time

from services.discover_jobs import work_once

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


def run_loop(
    poll_seconds: float = 3.0,
    stop_event: threading.Event | None = None,
    worker_id_suffix: str = "discover",
) -> None:
    worker_id = f"{socket.gethostname()}-{worker_id_suffix}"
    while not (stop_event and stop_event.is_set()):
        try:
            result = work_once(worker_id=worker_id)
            if result is None:
                time.sleep(poll_seconds)
        except KeyboardInterrupt:
            break
        except Exception:
            time.sleep(poll_seconds)


def main(poll_seconds: float = 3.0) -> None:
    run_loop(poll_seconds=poll_seconds)


if __name__ == "__main__":
    main()
