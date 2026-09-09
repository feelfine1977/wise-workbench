#!/usr/bin/env bash
# Install a complete source checkout; no sibling repositories are required.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV=0
case "${1:-}" in
  --dev) DEV=1; shift ;;
  --help|-h) echo 'Usage: tools/install.sh [--dev]'; exit 0 ;;
esac
if [ "$#" -ne 0 ]; then echo 'Usage: tools/install.sh [--dev]' >&2; exit 2; fi
PYTHON="${WISE_BOOTSTRAP_PYTHON:-python3}"
"$PYTHON" -c 'import sys; assert (3, 12) <= sys.version_info[:2] <= (3, 13), "Use Python 3.12 or 3.13; set WISE_BOOTSTRAP_PYTHON to that interpreter."'
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) { console.error("Use Node 24 for the supported installation profile."); process.exit(1); }'
VENV="$ROOT/apps/backend/.venv"
if [ ! -x "$VENV/bin/python" ]; then "$PYTHON" -m venv "$VENV"; fi
# Pin classic WISE independently of whichever extension checkout may exist on disk.
"$VENV/bin/python" -m pip install 'wise-pm @ git+https://github.com/feelfine1977/wise-pm.git@df5db50b839cc124b489a269894f5a2bfe7dc634'
if [ "$DEV" = 1 ]; then
  "$VENV/bin/python" -m pip install -e "$ROOT/packages/process-knowledge[dev]" -e "$ROOT/packages/wise-analytics[dev]" -e "$ROOT/apps/backend[dev]"
else
  "$VENV/bin/python" -m pip install -e "$ROOT/packages/process-knowledge" -e "$ROOT/packages/wise-analytics" -e "$ROOT/apps/backend"
fi
(cd "$ROOT/apps/frontend" && npm ci)
echo 'Installed classic WISE, analytics, knowledge and the real flow renderer. Run tools/start.sh.'
