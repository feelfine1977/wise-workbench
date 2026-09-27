#!/usr/bin/env bash
# Install a complete source checkout; no sibling repositories are required.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV=0
CORE=classic
usage() { echo 'Usage: tools/install.sh [--dev] [--core classic|next]'; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dev) DEV=1; shift ;;
    --core)
      if [ "$#" -lt 2 ]; then usage >&2; exit 2; fi
      CORE="$2"; shift 2 ;;
    --core=*) CORE="${1#--core=}"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
case "$CORE" in
  classic) VENV="$ROOT/apps/backend/.venv" ;;
  next) VENV="$ROOT/apps/backend/.venv-next" ;;
  *) echo "Unknown core profile: $CORE" >&2; usage >&2; exit 2 ;;
esac
# A candidate environment must never redirect installation into the classic environment.
if [ "$CORE" = next ] && [ -L "$VENV" ]; then
  echo 'apps/backend/.venv-next must be a separate virtual environment, not a symlink.' >&2
  exit 1
fi
PYTHON="${WISE_BOOTSTRAP_PYTHON:-python3}"
"$PYTHON" -c 'import sys; assert (3, 12) <= sys.version_info[:2] <= (3, 13), "Use Python 3.12 or 3.13; set WISE_BOOTSTRAP_PYTHON to that interpreter."'
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) { console.error("Use Node 24 for the supported installation profile."); process.exit(1); }'
REQUIREMENT="$("$PYTHON" "$ROOT/tools/check-core-profile.py" --core "$CORE" --requirement)"
if [ ! -x "$VENV/bin/python" ]; then "$PYTHON" -m venv "$VENV"; fi
# The commits can share a version: replace the core even in an existing environment.
# The editable product install below resolves its dependencies.
"$VENV/bin/python" -m pip install --force-reinstall --no-deps "$REQUIREMENT"
if [ "$DEV" = 1 ]; then
  "$VENV/bin/python" -m pip install -e "$ROOT/packages/process-knowledge[dev]" -e "$ROOT/packages/wise-analytics[dev]" -e "$ROOT/apps/backend[dev]"
else
  "$VENV/bin/python" -m pip install -e "$ROOT/packages/process-knowledge" -e "$ROOT/packages/wise-analytics" -e "$ROOT/apps/backend"
fi
"$VENV/bin/python" "$ROOT/tools/check-core-profile.py" --core "$CORE"
(cd "$ROOT/apps/frontend" && npm ci)
if [ "$CORE" = next ]; then
  echo 'Installed the pinned next candidate, analytics, knowledge and the real flow renderer.'
  echo 'Start with WISE_PYTHON=apps/backend/.venv-next/bin/python and a separate WISE_WORKSPACE; see docs/CORE_PROFILES.md.'
else
  echo 'Installed classic WISE, analytics, knowledge and the real flow renderer. Run tools/start.sh.'
fi
