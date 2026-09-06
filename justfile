# Task runner entry points (install `just` or read the commands).
backend-dev:
    cd apps/backend && uv run uvicorn wise_workbench.main:app --reload
worker:
    cd apps/backend && uv run wise-workbench worker
frontend-dev:
    cd apps/frontend && pnpm dev
test:
    cd apps/backend && uv run pytest
    cd apps/frontend && pnpm test
openapi:
    cd apps/backend && uv run wise-workbench openapi > ../../packages/api-schema/openapi.json
