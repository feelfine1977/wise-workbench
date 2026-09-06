#!/usr/bin/env bash
# Build the frontend once and start WISE Workbench serving it from the backend.
#
#   tools/start.sh                       build, then serve and open the browser
#   tools/start.sh --no-build            skip the build (use the existing apps/frontend/dist)
#   tools/start.sh --no-open --port 8010 any other argument is passed to `wise-workbench serve`
#
# Environment: WISE_WORKSPACE (default ~/WISE Workbench), WISE_PYTHON (the interpreter of the
# virtual environment that has wise-workbench installed; default apps/backend/.venv/bin/python).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$ROOT/apps/frontend"
BUILD=1
OPEN=--open
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --no-open) OPEN= ;;
    *) ARGS+=("$arg") ;;
  esac
done

PYTHON="${WISE_PYTHON:-$ROOT/apps/backend/.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  echo "No Python interpreter at $PYTHON." >&2
  echo "Create it first:  cd apps/backend && python3 -m venv .venv && .venv/bin/pip install -e ../../../wise-lib && .venv/bin/pip install -e ." >&2
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
    (cd "$FRONTEND" && npm install --no-audit --no-fund)
  fi
  echo "Building the frontend…" >&2
  (cd "$FRONTEND" && npm run build:live)
fi

# bash 3.2 (macOS) treats an empty array as unbound under `set -u`, hence the two expansions.
exec "$PYTHON" -m wise_workbench.cli serve ${OPEN:+"$OPEN"} ${ARGS[@]+"${ARGS[@]}"}
