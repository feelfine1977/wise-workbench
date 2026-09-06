"""The built frontend is served next to the API: assets, real files, history fallback, API precedence."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_settings
from wise_workbench.api.app import create_app, openapi_document
from wise_workbench.cli import build_parser
from wise_workbench.settings import Settings


@pytest.fixture
def static_dir(tmp_path: Path) -> Path:
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text(
        '<!doctype html><title>WISE Workbench</title><div id="root"></div>', encoding="utf-8"
    )
    (root / "assets" / "index-abc123.js").write_text("console.log('app')", encoding="utf-8")
    (root / "mockServiceWorker.js").write_text("// worker", encoding="utf-8")
    return root


@pytest.fixture
def spa(tmp_path: Path, static_dir: Path) -> TestClient:
    app = create_app(make_settings(tmp_path, static_dir=static_dir))
    with TestClient(app) as client:
        yield client


def test_index_and_history_fallback(spa: TestClient) -> None:
    for path in ("/", "/p/prj_1", "/p/prj_1/runs/run_1/backlog?slicing=case%20Vendor&view=Finance", "/projects"):
        r = spa.get(path)
        assert r.status_code == 200, path
        assert r.headers["content-type"].startswith("text/html")
        assert 'id="root"' in r.text
        assert r.headers["cache-control"] == "no-cache"


def test_assets_and_root_files_are_served(spa: TestClient) -> None:
    r = spa.get("/assets/index-abc123.js")
    assert r.status_code == 200 and "console.log" in r.text
    assert "javascript" in r.headers["content-type"]
    r = spa.get("/mockServiceWorker.js")
    assert r.status_code == 200 and r.text == "// worker"
    assert spa.get("/assets/missing.js").status_code == 404


def test_api_and_docs_keep_precedence(spa: TestClient) -> None:
    assert spa.get("/api/v1/system/health").json()["status"] == "ok"
    assert spa.get("/api/v1/projects").status_code == 200
    r = spa.get("/api/v1/nothing/here")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/problem+json")
    assert r.json()["status"] == 404
    assert spa.get("/docs").status_code == 200 and "swagger" in spa.get("/docs").text.lower()
    assert spa.get("/api/v1/openapi.json").status_code == 200


def test_paths_outside_the_static_directory_fall_back_to_the_index(spa: TestClient, static_dir: Path) -> None:
    (static_dir.parent / "secret.txt").write_text("outside", encoding="utf-8")
    r = spa.get("/../secret.txt")
    assert r.status_code == 200 and "outside" not in r.text
    r = spa.get("/%2e%2e/secret.txt")
    assert r.status_code == 200 and "outside" not in r.text


def test_without_a_built_frontend_only_the_api_is_served(tmp_path: Path) -> None:
    app = create_app(make_settings(tmp_path, static_dir=tmp_path / "nowhere"))
    with TestClient(app) as client:
        assert client.get("/api/v1/system/health").status_code == 200
        r = client.get("/")
        assert r.status_code == 404 and r.headers["content-type"].startswith("application/problem+json")


def test_static_routes_stay_out_of_the_contract(tmp_path: Path, static_dir: Path) -> None:
    doc = openapi_document(create_app(make_settings(tmp_path, static_dir=static_dir)))
    assert all(p.startswith("/") and not p.startswith("/{") for p in doc["paths"])
    assert "/{path}" not in doc["paths"]


def test_resolved_static_dir(tmp_path: Path, static_dir: Path) -> None:
    assert Settings(static_dir=static_dir).resolved_static_dir == static_dir.resolve()
    assert Settings(static_dir=tmp_path / "empty").resolved_static_dir is None
    found = Settings().resolved_static_dir
    assert found is None or (found / "index.html").is_file()


def test_serve_accepts_open_and_static() -> None:
    args = build_parser().parse_args(["serve", "--open", "--static", "/tmp/dist", "--port", "8123"])
    assert args.open is True and args.static == "/tmp/dist" and args.port == 8123
