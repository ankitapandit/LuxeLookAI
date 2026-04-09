#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# dev.sh — LuxeLook AI development startup script
#
# Usage:
#   ./dev.sh          — start both backend + frontend
#   ./dev.sh setup    — first-time setup: venv, npm install, copy .env files
#   ./dev.sh backend  — start backend only (with live log tail)
#   ./dev.sh frontend — start frontend only (with live log tail)
#   ./dev.sh stop     — kill all running dev processes
#   ./dev.sh logs     — show recent logs from both services
#
# Requirements: Python 3.10–3.12, Node 18+, npm
# uv is installed automatically if missing (10-100x faster than pip on macOS)
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
LOG_DIR="$SCRIPT_DIR/.dev-logs"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
PID_FILE="$SCRIPT_DIR/.dev-pids"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

log()    { echo -e "${BOLD}${BLUE}▶${RESET} $*"; }
ok()     { echo -e "${GREEN}✓${RESET} $*"; }
warn()   { echo -e "${YELLOW}⚠${RESET}  $*"; }
error()  { echo -e "${RED}✗${RESET} $*" >&2; }
header() { echo -e "\n${BOLD}${CYAN}$*${RESET}"; }

# ── Detect uv ─────────────────────────────────────────────────────────────────
# uv is a Rust-based pip replacement — 10-100x faster installs, especially on
# macOS where pip is slow due to sequential downloads + many small files.
# Falls back to pip automatically if uv is not installed.
USE_UV=false
if command -v uv &>/dev/null; then
  USE_UV=true
fi

# Install deps using uv if available, pip otherwise
# Args: same as pip install (e.g. "-r requirements.txt")
pip_install() {
  if [ "$USE_UV" = true ]; then
    uv pip install "$@"
  else
    pip install --quiet "$@"
  fi
}


# ═══════════════════════════════════════════════════════════════════════════════
# SETUP — first-time install
# ═══════════════════════════════════════════════════════════════════════════════

cmd_setup() {
  header "LuxeLook AI — First-time setup"

  # ── Check prerequisites ────────────────────────────────────────────────────
  log "Checking prerequisites..."
  
  # Strip macOS quarantine flag — prevents "Operation timed out" on file reads
  # This is safe and only affects this project directory
  xattr -rd com.apple.quarantine "$SCRIPT_DIR" 2>/dev/null || true

  if ! command -v python3 &>/dev/null; then
    error "Python 3 not found. Install from https://python.org (3.10+ required)"
    exit 1
  fi
  PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
  PYTHON_MAJOR=$(echo "$PYTHON_VERSION" | cut -d. -f1)
  PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f2)
  if [ "$PYTHON_MAJOR" -lt 3 ] || { [ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 10 ]; }; then
    error "Python 3.10+ required (found $PYTHON_VERSION). Installing latest."
    brew update
    brew install python
    exit 1
  fi
  ok "Python $PYTHON_VERSION"

  if ! command -v node &>/dev/null; then
    error "Node.js not found. Install from https://nodejs.org (18+ required)"
    exit 1
  fi
  NODE_VERSION=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
  if [ "$NODE_VERSION" -lt 18 ]; then
    error "Node 18+ required (found v$NODE_VERSION). Installing latest."
    brew update
    brew install node
    exit 1
  fi
  ok "Node v$(node --version | tr -d v)"

# ── uv detection + offer to install ───────────────────────────────────────
  if [ "$USE_UV" = true ]; then
    ok "uv $(uv --version | awk '{print $2}') detected — using fast installs"
  else
    echo ""
    warn "uv not found — installing automatically (10-100x faster than pip on macOS)"
    echo ""
    log "Installing uv..."
    echo "y" | curl -LsSf https://astral.sh/uv/install.sh | sh
    # Reload PATH so uv is available in this session
    export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
    if command -v uv &>/dev/null; then
        USE_UV=true
        ok "uv installed successfully"
    else
        warn "uv installed but not in PATH yet — using pip for now"
        warn "Restart your terminal and re-run setup to use uv next time"
    fi
    echo ""
  fi

  # ── Python version check for torch compatibility ───────────────────────────
  # torch 2.3.0 wheels only exist for cp38–cp312.
  # uv can download Python 3.12 automatically; without uv the user must do it.
  VENV_PYTHON_ARG=""
  if [ "$PYTHON_MINOR" -ge 13 ] || [ "$PYTHON_MAJOR" -gt 3 ]; then
    if [ "$USE_UV" = true ]; then
      warn "System Python is $PYTHON_VERSION — torch wheels only support up to 3.12"
      warn "uv will create the venv with Python 3.12 instead (downloaded automatically)"
      VENV_PYTHON_ARG="--python 3.12"
    else
      warn "System Python is $PYTHON_VERSION — torch 2.3.0 wheels only support up to 3.12"
      warn "Please install Python 3.12 and re-run, or install uv (it handles this automatically)"
      warn "Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh"
      warn "Continuing anyway — install may fail at torch"
    fi
  fi

  # ── Backend venv + deps ────────────────────────────────────────────────────
  header "Setting up backend..."

  cd "$BACKEND_DIR"

  # If a venv exists but was built with the wrong Python version, remove it
  # so it gets recreated with the correct one (e.g. 3.14→3.12 for torch compat)
  if [ -d "venv" ] && [ -n "$VENV_PYTHON_ARG" ]; then
    EXISTING_PY=$(venv/bin/python --version 2>/dev/null | awk '{print $2}' | cut -d. -f1,2 || echo "unknown")
    if [ "$EXISTING_PY" != "3.12" ]; then
      warn "Existing venv uses Python $EXISTING_PY — removing and recreating with Python 3.12..."
      rm -rf venv
    fi
  fi

  if [ ! -d "venv" ]; then
    log "Creating Python virtual environment..."
    if [ "$USE_UV" = true ]; then
      # shellcheck disable=SC2086
      uv venv venv $VENV_PYTHON_ARG
    else
      python3 -m venv venv
    fi
    ok "Virtual environment created"
  else
    VENV_PY=$(venv/bin/python --version 2>/dev/null | awk '{print $2}' || echo "unknown")
    ok "Virtual environment already exists (Python $VENV_PY)"
  fi

  log "Installing Python dependencies..."
  if [ "$USE_UV" = true ]; then
    # uv installs directly into the venv — no activate/deactivate needed
    # uv pip install --python venv/bin/python -r requirements.txt
    uv pip install --python venv/bin/python -r "$BACKEND_DIR/requirements.txt"
  else
    # shellcheck disable=SC1091
    source venv/bin/activate
    pip install --quiet --upgrade pip
    pip install --quiet -r requirements.txt
    deactivate
  fi
  ok "Python dependencies installed"

  if [ ! -f ".env" ]; then
    cp .env.example .env
    warn "Created backend/.env from .env.example"
    warn "→ Open backend/.env and fill in your values before running"
  else
    ok "backend/.env already exists"
  fi

  # ── Frontend deps ──────────────────────────────────────────────────────────
  header "Setting up frontend..."

  cd "$FRONTEND_DIR"

  log "Installing Node dependencies..."
  # Always do a clean install to avoid stale lock file conflicts
  rm -f package-lock.json
  if ! npm install; then
    warn "npm install failed — wiping node_modules and retrying clean..."
    chmod -R 777 node_modules 2>/dev/null || true
    rm -rf node_modules
    npm install --no-audit --no-fund
  fi
  ok "Installed pinned frontend dependencies from package.json"
  ok "Node dependencies installed"

  if [ ! -f ".env.local" ]; then
    cp .env.local.example .env.local
    warn "Created frontend/.env.local from .env.local.example"
    warn "→ Open frontend/.env.local and fill in your values before running"
  else
    ok "frontend/.env.local already exists"
  fi

  # Note: Next.js 15 with Turbopack does a cold compile on first start (~60s).
  # Subsequent starts are fast because the .next/ cache is reused.
  # The cache is preserved between restarts — only wiped if you delete .next/
  # ── Done ──────────────────────────────────────────────────────────────────
  header "Setup complete!"
  echo ""
  echo -e "  ${BOLD}Next steps:${RESET}"
  echo ""
  if grep -q "your-project-id" "$BACKEND_DIR/.env" 2>/dev/null; then
    echo -e "  ${YELLOW}1.${RESET} Fill in ${BOLD}backend/.env${RESET} with your keys"
    echo -e "  ${YELLOW}2.${RESET} Fill in ${BOLD}frontend/.env.local${RESET} with your keys"
    echo -e "  ${YELLOW}3.${RESET} Run ${BOLD}./dev.sh${RESET} to start everything"
  else
    echo -e "  ${GREEN}1.${RESET} Run ${BOLD}./dev.sh${RESET} to start everything"
  fi
  echo ""
}


# ═══════════════════════════════════════════════════════════════════════════════
# START BACKEND
# ═══════════════════════════════════════════════════════════════════════════════

start_backend() {
  if [ ! -d "$BACKEND_DIR/venv" ]; then
    error "Backend not set up. Run: ./dev.sh setup"
    exit 1
  fi
  if [ ! -f "$BACKEND_DIR/.env" ]; then
    error "backend/.env not found. Run: ./dev.sh setup"
    exit 1
  fi
 
  mkdir -p "$LOG_DIR"
  cd "$BACKEND_DIR"
  > "$BACKEND_LOG"
 
  log "Launching backend..."
  venv/bin/uvicorn main:app --port 8000 >> "$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!
  echo "$BACKEND_PID" >> "$PID_FILE"

  ok "Backend running (PID $BACKEND_PID) → http://localhost:8000"
  ok "API docs → http://localhost:8000/docs"
}


# ═══════════════════════════════════════════════════════════════════════════════
# START FRONTEND
# ═══════════════════════════════════════════════════════════════════════════════

start_frontend() {
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    error "Frontend not set up. Run: ./dev.sh setup"
    exit 1
  fi
  if [ ! -f "$FRONTEND_DIR/.env.local" ]; then
    error "frontend/.env.local not found. Run: ./dev.sh setup"
    exit 1
  fi
 
  mkdir -p "$LOG_DIR"
  cd "$FRONTEND_DIR"
  > "$FRONTEND_LOG"
 
  log "Launching frontend..."
  NODE_OPTIONS=--max-old-space-size=4096 npm run dev >> "$FRONTEND_LOG" 2>&1 &
  FRONTEND_PID=$!
  echo "$FRONTEND_PID" >> "$PID_FILE"

  ok "Frontend running (PID $FRONTEND_PID) → http://localhost:3000"
}


# ═══════════════════════════════════════════════════════════════════════════════
# STOP
# ═══════════════════════════════════════════════════════════════════════════════

cmd_stop() {
  if [ ! -f "$PID_FILE" ]; then
    warn "No PID file found — nothing to stop (or already stopped)"
    return
  fi

  log "Stopping LuxeLook AI services..."
  while IFS= read -r pid; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && ok "Stopped PID $pid"
    fi
  done < "$PID_FILE"

  rm -f "$PID_FILE"
  ok "All services stopped"
}


# ═══════════════════════════════════════════════════════════════════════════════
# LOGS
# ═══════════════════════════════════════════════════════════════════════════════

cmd_logs() {
  mkdir -p "$LOG_DIR"
  if [ ! -f "$BACKEND_LOG" ] && [ ! -f "$FRONTEND_LOG" ]; then
    warn "No log files found yet. Start the services first."
    return
  fi

  echo -e "\n${BOLD}${CYAN}══ Backend log ($BACKEND_LOG) ═══════════════════════${RESET}"
  tail -n 40 "$BACKEND_LOG" 2>/dev/null || warn "No backend log yet"

  echo -e "\n${BOLD}${CYAN}══ Frontend log ($FRONTEND_LOG) ══════════════════════${RESET}"
  tail -n 40 "$FRONTEND_LOG" 2>/dev/null || warn "No frontend log yet"

  echo ""
  echo -e "  ${BOLD}Live tail:${RESET} tail -f $LOG_DIR/backend.log $LOG_DIR/frontend.log"
}


# ═══════════════════════════════════════════════════════════════════════════════
# START BOTH - launch both in background then report PIDs
# ═══════════════════════════════════════════════════════════════════════════════

cmd_start() {
  header "LuxeLook AI — Starting dev environment"

  rm -f "$PID_FILE"
 
  start_backend
  start_frontend
 
  # Give both a moment to initialise before checking
  echo ""
  log "Waiting for services to initialise..."
  sleep 5
 
  BACKEND_OK=false
  FRONTEND_OK=false
  kill -0 "$BACKEND_PID"  2>/dev/null && BACKEND_OK=true
  kill -0 "$FRONTEND_PID" 2>/dev/null && FRONTEND_OK=true
 
  echo ""
  if [ "$BACKEND_OK" = true ]; then
    ok "Backend  → http://localhost:8000  (PID $BACKEND_PID)"
    ok "API docs → http://localhost:8000/docs"
  else
    error "Backend failed to start (PID $BACKEND_PID)"
  fi
 
  if [ "$FRONTEND_OK" = true ]; then
    ok "Frontend → http://localhost:3000  (PID $FRONTEND_PID)"
  else
    error "Frontend failed to start (PID $FRONTEND_PID)"
  fi
 
  if [ "$BACKEND_OK" = false ] || [ "$FRONTEND_OK" = false ]; then
    echo ""
    warn "One or more services failed — run: ./dev.sh logs"
    exit 1
  fi
 
  echo ""
  echo -e "  ${BOLD}Stop:${RESET}      ./dev.sh stop"
  echo -e "  ${BOLD}Logs:${RESET}      ./dev.sh logs"
  echo -e "  ${BOLD}Live logs:${RESET} tail -f $LOG_DIR/backend.log $LOG_DIR/frontend.log"
  echo ""
}


# ═══════════════════════════════════════════════════════════════════════════════
# Entry point
# ═══════════════════════════════════════════════════════════════════════════════

CMD="${1:-start}"

case "$CMD" in
  setup)   cmd_setup ;;
  start)   cmd_start ;;
  stop)    cmd_stop  ;;
  logs)    cmd_logs  ;;
 
  backend)
    rm -f "$PID_FILE"
    start_backend
    ok "Backend  → http://localhost:8000  (PID $BACKEND_PID)"
    ok "API docs → http://localhost:8000/docs"
    tail -f "$BACKEND_LOG"
    ;;
 
  frontend)
    rm -f "$PID_FILE"
    start_frontend
    ok "Frontend → http://localhost:3000  (PID $FRONTEND_PID)"
    tail -f "$FRONTEND_LOG"
    ;;
 
  *)
    echo -e "Usage: ${BOLD}./dev.sh${RESET} [setup|start|backend|frontend|stop|logs]"
    echo ""
    echo "  setup     — first-time install: venv, npm install, copy .env files"
    echo "  start     — start backend + frontend (default)"
    echo "  backend   — start backend only, tail its log"
    echo "  frontend  — start frontend only, tail its log"
    echo "  stop      — stop all running services"
    echo "  logs      — show recent logs from both services"
    exit 1
    ;;
esac
