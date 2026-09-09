#!/usr/bin/env bash
# Build the frontend once and start WISE Workbench serving it from the backend.
#
#   tools/start.sh                       build, then serve and open the browser
#   tools/start.sh --no-build            skip the build (use the existing apps/frontend/dist)
#   tools/start.sh --no-open --port 8010 any other argument is passed to `wise-workbench serve`
#   tools/start.sh --replace             stop whatever already listens on the port, then start
#
# The port is checked before the frontend is built, so a port that is already in use costs a
# second rather than a full build.
#
# Environment: WISE_WORKSPACE (default ~/WISE Workbench), WISE_PYTHON (the interpreter of the
# virtual environment that has wise-workbench installed; default apps/backend/.venv/bin/python).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$ROOT/apps/frontend"
BUILD=1
OPEN=--open
REPLACE=0
PORT=8000
ARGS=()
expect_port=0
for arg in "$@"; do
  if [ "$expect_port" = 1 ]; then
    PORT="$arg"; expect_port=0; ARGS+=("$arg"); continue
  fi
  case "$arg" in
    --no-build) BUILD=0 ;;
    --no-open) OPEN= ;;
    --replace) REPLACE=1 ;;
    --port) expect_port=1; ARGS+=("$arg") ;;
    --port=*) PORT="${arg#--port=}"; ARGS+=("$arg") ;;
    --port:*|-port*|-p:*)
      echo "The port is a separate argument or an = pair: --port ${arg##*[:=]} or --port=${arg##*[:=]}" >&2
      exit 2 ;;
    *) ARGS+=("$arg") ;;
  esac
done

# Fail on an occupied port before spending a minute on the build.
holder="$(lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
if [ -n "$holder" ]; then
  if [ "$REPLACE" = 1 ]; then
    echo "Stopping the process on port $PORT (pid $holder)…" >&2
    kill "$holder" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
      sleep 0.5
    done
    if lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Port $PORT is still held by pid $holder; stop it yourself and start again." >&2
      exit 1
    fi
  else
    echo "Port $PORT is already in use by pid $holder:" >&2
    ps -o pid,lstart,command -p "$holder" | sed 1d | cut -c1-160 >&2
    echo >&2
    echo "Either free it            kill $holder" >&2
    echo "or let this script do it  tools/start.sh --replace" >&2
    echo "or choose another port    tools/start.sh --port 8010" >&2
    exit 1
  fi
fi

PYTHON="${WISE_PYTHON:-$ROOT/apps/backend/.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  echo "No Python interpreter at $PYTHON." >&2
  echo "Install the complete checkout first: tools/install.sh --dev" >&2
  echo "or point WISE_PYTHON at the interpreter of an environment that has wise-workbench installed." >&2
  exit 1
fi
if ! "$PYTHON" -c "import wise_workbench" 2>/dev/null; then
  echo "wise-workbench is not installed in $PYTHON; run: $(dirname "$PYTHON")/pip install -e $ROOT/apps/backend" >&2
  exit 1
fi

if [ "$BUILD" = 1 ] || [ ! -f "$FRONTEND/dist/index.html" ]; then
  command -v npm >/dev/null || { echo "npm is required to build the frontend (Node 18 or newer)." >&2; exit 1; }
  if [ ! -d "$FRONTEND/node_modules" ]; then
    echo "Installing frontend dependencies…" >&2
    (cd "$FRONTEND" && npm ci --no-audit --no-fund)
  fi
  echo "Building the frontend…" >&2
  (cd "$FRONTEND" && npm run build:live)
fi

# bash 3.2 (macOS) treats an empty array as unbound under `set -u`, hence the two expansions.
exec "$PYTHON" -m wise_workbench.cli serve ${OPEN:+"$OPEN"} ${ARGS[@]+"${ARGS[@]}"}
