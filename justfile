# Optional convenience wrapper; npm and the project Python environment are canonical.
install:
    tools/install.sh --dev
start:
    tools/start.sh
backend-dev:
    cd apps/backend && .venv/bin/python -m uvicorn wise_workbench.main:app --reload
worker:
    apps/backend/.venv/bin/wise-workbench worker
frontend-dev:
    cd apps/frontend && npm run dev
test:
    cd apps/backend && .venv/bin/python -m pytest
    cd apps/frontend && npm test
openapi:
    apps/backend/.venv/bin/wise-workbench openapi --yaml --out packages/api-schema/openapi.yaml
    cd apps/frontend && npm run generate
