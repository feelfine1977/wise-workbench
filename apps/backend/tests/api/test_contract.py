"""The generated OpenAPI document covers the contract's paths, operations and schemas."""

from __future__ import annotations

import pytest
import yaml

from tests.conftest import REPO_ROOT
from wise_workbench.api.app import openapi_document

CONTRACT = REPO_ROOT / "packages" / "api-schema" / "openapi.yaml"


@pytest.fixture(scope="module")
def generated() -> dict:
    return openapi_document()


@pytest.fixture(scope="module")
def contract() -> dict:
    if not CONTRACT.exists():
        pytest.skip("contract file not available")
    return yaml.safe_load(CONTRACT.read_text(encoding="utf-8"))


def test_every_contract_operation_exists(generated: dict, contract: dict) -> None:
    missing = []
    for path, ops in contract["paths"].items():
        gen_ops = generated["paths"].get(path)
        if gen_ops is None:
            missing.append(path)
            continue
        for method, op in ops.items():
            if method == "parameters":
                continue
            gen_op = gen_ops.get(method)
            if gen_op is None or gen_op.get("operationId") != op.get("operationId"):
                missing.append(f"{method.upper()} {path} ({op.get('operationId')})")
    assert missing == [], f"operations missing from the generated document: {missing}"


def test_contract_schemas_are_present(generated: dict, contract: dict) -> None:
    gen_schemas = set(generated["components"]["schemas"])
    expected = set(contract["components"]["schemas"])
    assert expected <= gen_schemas, f"schemas missing: {sorted(expected - gen_schemas)}"
    contract_row = contract["components"]["schemas"]["BacklogRow"]["properties"]
    row = generated["components"]["schemas"]["BacklogRow"]["properties"]
    assert set(contract_row) <= set(row)
    assert set(contract["components"]["schemas"]["FlowGraph"]["required"]) <= set(
        generated["components"]["schemas"]["FlowGraph"]["required"]
    )


def test_backlog_query_parameters(generated: dict, contract: dict) -> None:
    path = "/projects/{projectId}/runs/{runId}/backlog"
    contract_params = {p["name"] for p in contract["paths"][path]["get"]["parameters"] if "name" in p}
    generated_params = {p["name"] for p in generated["paths"][path]["get"]["parameters"]}
    assert contract_params <= generated_params
    assert {
        "slicing",
        "view",
        "gamma",
        "minCases",
        "sort",
        "hotspotType",
        "kind",
        "layer",
        "q",
        "page",
        "pageSize",
    } <= generated_params
    assert generated["servers"] == [{"url": "/api/v1"}]


def test_committed_contract_equals_the_generated_document(generated: dict, contract: dict) -> None:
    """``packages/api-schema/openapi.yaml`` is regenerated from the backend and committed; any drift fails here.

    Regenerate with ``.venv/bin/wise-workbench openapi --yaml --out ../../packages/api-schema/openapi.yaml``
    and then ``npm run generate`` in ``apps/frontend``.
    """
    assert contract == generated, (
        "packages/api-schema/openapi.yaml differs from the backend's OpenAPI document; regenerate it with "
        "`.venv/bin/wise-workbench openapi --yaml --out ../../packages/api-schema/openapi.yaml`"
    )
