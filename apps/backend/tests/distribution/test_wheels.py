"""Install built wheels outside the checkout; exercise resources, migrations and SPA routes."""

from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

from tests.conftest import REPO_ROOT


def test_installed_release(tmp_path: Path, dependency_profile: str) -> None:
    frontend = tmp_path / "frontend"
    (frontend / "assets" / "nested").mkdir(parents=True)
    (frontend / "index.html").write_text('<!doctype html><title>Release smoke</title><div id="root"></div>')
    (frontend / "assets" / "nested" / "app.js").write_text("console.log('release-smoke')")
    (frontend / "favicon.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
    build_repo = tmp_path / "release-input"
    (build_repo / "tools").mkdir(parents=True)
    shutil.copy2(REPO_ROOT / "tools" / "build_release.py", build_repo / "tools" / "build_release.py")
    backend = build_repo / "apps" / "backend"
    backend.mkdir(parents=True)
    for name in ("pyproject.toml", "README.md"):
        shutil.copy2(REPO_ROOT / "apps" / "backend" / name, backend / name)
    shutil.copytree(
        REPO_ROOT / "apps" / "backend" / "src",
        backend / "src",
        ignore=shutil.ignore_patterns("__pycache__", "*.egg-info", "static", "distribution"),
    )
    (build_repo / "THIRD_PARTY_NOTICES.md").write_text("Synthetic application attribution fixture")
    vendor = build_repo / "vendor"
    vendor.mkdir()
    tarball = vendor / "wise-flow-test.tgz"
    with tarfile.open(tarball, "w:gz") as archive:
        for name in (
            "LICENSE",
            "THIRD_PARTY_NOTICES.md",
            "dist/licenses/bpmn-js.txt",
            "dist/licenses/@xyflow-react.txt",
            "dist/licenses/elkjs.txt",
        ):
            data = f"Synthetic renderer attribution: {name}".encode()
            member = tarfile.TarInfo(f"package/{name}")
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
    (vendor / "wise-flow.provenance.json").write_text(
        json.dumps(
            {
                "package": "@wise/flow",
                "tarball": tarball.name,
                "sha256": hashlib.sha256(tarball.read_bytes()).hexdigest(),
            }
        )
    )
    wheels = tmp_path / "wheels"
    subprocess.run(
        [
            sys.executable,
            str(build_repo / "tools" / "build_release.py"),
            "--frontend-dist",
            str(frontend),
            "--out",
            str(wheels),
            "--frontend-mode",
            "live",
            "--no-isolation",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    # Build a staged knowledge copy so even setuptools build/egg-info stays out of the checkout.
    knowledge = tmp_path / "knowledge-source"
    package = REPO_ROOT / "packages" / "process-knowledge"
    knowledge.mkdir()
    for name in ("pyproject.toml", "README.md"):
        shutil.copy2(package / name, knowledge / name)
    shutil.copytree(package / "src", knowledge / "src", ignore=shutil.ignore_patterns("__pycache__", "*.egg-info"))
    subprocess.run(
        [sys.executable, "-m", "build", "--sdist", "--outdir", str(wheels), "--no-isolation", str(knowledge)],
        check=True,
        capture_output=True,
        text=True,
    )
    # Round-trip the sdist as well as the wheel, so release source archives cannot lose resources.
    (sdist,) = wheels.glob("wise_knowledge-*.tar.gz")
    unpacked = tmp_path / "sdist"
    shutil.unpack_archive(sdist, unpacked)
    (source,) = unpacked.iterdir()
    subprocess.run(
        [sys.executable, "-m", "build", "--wheel", "--outdir", str(wheels), "--no-isolation", str(source)],
        check=True,
        capture_output=True,
        text=True,
    )
    installed = tmp_path / "installed"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--no-deps",
            "--no-index",
            "--target",
            str(installed),
            *map(str, sorted(wheels.glob("*.whl"))),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    for path in (frontend, knowledge, unpacked, build_repo):
        shutil.rmtree(path)
    # -I ignores PYTHONPATH and cwd; only wheel installs are prepended, with the test venv supplying dependencies.
    # Origin assertions also prevent editable source installs from making this check pass accidentally.
    env = {k: v for k, v in os.environ.items() if not k.startswith("WISE_") and k != "PYTHONPATH"}
    outside = tmp_path / "outside"
    outside.mkdir()
    result = subprocess.run(
        [
            sys.executable,
            "-I",
            str(Path(__file__).with_name("smoke_installed.py")),
            "--installed-target",
            str(installed),
            "--profile",
            dependency_profile,
        ],
        cwd=outside,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    assert "installed wheels:" in result.stdout


def test_release_requires_explicit_live_declaration(tmp_path: Path) -> None:
    result = subprocess.run(
        [
            sys.executable,
            str(REPO_ROOT / "tools" / "build_release.py"),
            "--frontend-dist",
            str(tmp_path),
            "--out",
            str(tmp_path / "out"),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2 and "--frontend-mode" in result.stderr
    assert not (tmp_path / "out").exists()
