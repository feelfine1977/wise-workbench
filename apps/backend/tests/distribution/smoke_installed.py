"""Verify release wheels from an outside-checkout directory, with a synthetic workspace.

After installing the backend, knowledge and analytics wheels into a fresh venv:
    cd "$(mktemp -d)"
    /path/to/venv/bin/python -I /path/to/repo/apps/backend/tests/distribution/smoke_installed.py
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import sys
import tempfile
from importlib import metadata
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--installed-target", type=Path, help="pip --target directory (used by the wheel test)")
    parser.add_argument("--profile", choices=("full", "minimal"), default="full")
    args = parser.parse_args()
    checkout = Path(__file__).resolve().parents[4]
    assert not Path.cwd().resolve().is_relative_to(checkout), "run this smoke test from outside the checkout"
    if args.installed_target:
        sys.path.insert(0, str(args.installed_target.resolve()))
    # Configuration must not redirect verification to a user's live workspace or external resources.
    for key in list(os.environ):
        if key.startswith("WISE_"):
            del os.environ[key]
    for name in ("wise_workbench", "wise_knowledge"):
        module = importlib.import_module(name)
        origin = Path(module.__file__).resolve()
        assert not origin.is_relative_to(checkout), origin
        if args.installed_target:
            assert origin.is_relative_to(args.installed_target.resolve()), origin
        dist = metadata.distribution(name.replace("_", "-"))
        assert origin == Path(dist.locate_file(f"{name}/__init__.py")).resolve(), origin
    from wise_knowledge import available_packs, load_datasets, load_pack, validate_datasets, validate_pack
    from wise_knowledge.paths import entry_point_packs, knowledge_root

    from wise_workbench.adapters.engine.analytics import availability

    assert availability()["available"] == (args.profile == "full"), availability()
    assert set(available_packs()) == {"p2p", "o2c"}
    assert set(entry_point_packs()) == {"p2p", "o2c"}
    assert knowledge_root().is_relative_to(Path(importlib.import_module("wise_knowledge").__file__).parent)
    assert not validate_datasets()
    assert load_datasets().datasets
    import wise

    for name in ("p2p", "o2c"):
        assert not validate_pack(name)
        pack = load_pack(name)
        assert pack.activities and pack.guidance and pack.templates and pack.mappings
        for template in pack.templates:
            assert template.path.is_relative_to(knowledge_root())
            wise.Norm.load(template.path).validate()
    assert load_pack("o2c").presets["icpm2026_o2c"].path.is_file()
    from fastapi.testclient import TestClient

    from wise_workbench.api.app import create_app
    from wise_workbench.settings import Settings

    with tempfile.TemporaryDirectory(prefix="wise-wheel-workspace-") as tmp:
        workspace = Path(tmp)
        settings = Settings(workspace=workspace, inprocess_worker=False, log_level="WARNING")
        static = settings.resolved_static_dir
        package_dir = Path(importlib.import_module("wise_workbench").__file__).parent
        assert static is not None and static == package_dir / "static", static
        distribution = package_dir / "distribution"
        for name in (
            "THIRD_PARTY_NOTICES.md",
            "wise-flow.provenance.json",
            "wise-flow/LICENSE",
            "wise-flow/THIRD_PARTY_NOTICES.md",
            "wise-flow/dist/licenses/bpmn-js.txt",
            "wise-flow/dist/licenses/@xyflow-react.txt",
            "wise-flow/dist/licenses/elkjs.txt",
        ):
            assert (distribution / name).is_file(), name
        assert json.loads((distribution / "frontend-contract.json").read_text())["frontendMode"] == "live"

        assert settings.bpic19_csv is None and settings.preset_data_dirs == []
        assert settings.bpic19_norm.is_relative_to(knowledge_root())
        index = (static / "index.html").read_bytes()
        with TestClient(create_app(settings)) as client:
            for url in ("/", "/p/synthetic/runs/example/backlog?view=Finance"):
                response = client.get(url)
                assert response.status_code == 200 and response.content == index
                assert response.headers["cache-control"] == "no-cache"
            assets = [p for p in static.rglob("*") if p.is_file() and p.name != "index.html"]
            assert assets, "frontend wheel must include assets as well as index.html"
            for asset in assets:
                response = client.get("/" + asset.relative_to(static).as_posix())
                assert response.status_code == 200 and response.content == asset.read_bytes(), asset
            assert client.get("/assets/missing-wheel-smoke.js").status_code == 404
            assert client.get("/api/v1/system/health").json()["status"] == "ok"
            assert client.get("/api/v1/nothing").status_code == 404
            assert client.get("/docs").status_code == 200
            doc = client.get("/api/v1/openapi.json")
            assert doc.status_code == 200
            for operations in doc.json()["paths"].values():
                for operation in operations.values():
                    response = operation.get("responses", {}).get("422", {})
                    assert response.get("description") != "Unprocessable Entity"
            project = client.post("/api/v1/projects", json={"name": "Synthetic release", "process": "p2p"})
            assert project.status_code == 201, project.text
            presets = client.get(f"/api/v1/projects/{project.json()['id']}/datasets/presets").json()
            assert {p["id"] for p in presets} >= {"bpic2019", "icpm2026_o2c"}
            assert all(not p["available"] for p in presets)
        assert (workspace / "workbench.db").is_file()
    print("installed wheels: packs, schemas, templates, presets, migrations, SPA and API OK")


if __name__ == "__main__":
    main()
