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
# The contract and the types the frontend reads from it, in one step: the generated types are part of the
# release and must never be older than `packages/api-schema/openapi.yaml` (CI checks both).
openapi:
    cd apps/backend && uv run wise-workbench openapi --yaml --out ../../packages/api-schema/openapi.yaml
    cd apps/frontend && npm run generate
