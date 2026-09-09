#!/usr/bin/env python3
"""Build the backend wheel with a supplied frontend dist, without changing the checkout."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path


def attribution_files(root: Path) -> dict[str, bytes]:
    """Read notices from the pinned renderer artifact, without npm or a sibling checkout."""
    files = {
        "THIRD_PARTY_NOTICES.md": (root / "THIRD_PARTY_NOTICES.md").read_bytes(),
        "wise-flow.provenance.json": (root / "vendor" / "wise-flow.provenance.json").read_bytes(),
    }
    provenance = json.loads(files["wise-flow.provenance.json"])
    filename = provenance["tarball"]
    if not isinstance(filename, str) or Path(filename).name != filename or provenance["package"] != "@wise/flow":
        raise ValueError("invalid vendored flow provenance")
    tarball = root / "vendor" / filename
    if hashlib.sha256(tarball.read_bytes()).hexdigest() != provenance["sha256"]:
        raise ValueError("vendored flow tarball does not match its provenance SHA-256")
    with tarfile.open(tarball) as archive:
        for member in archive.getmembers():
            name = member.name
            if name in {
                "package/LICENSE",
                "package/THIRD_PARTY_NOTICES.md",
            } or name.startswith("package/dist/licenses/"):
                if not member.isfile():
                    continue
                relative = Path(name.removeprefix("package/"))
                if ".." in relative.parts:
                    raise ValueError("unsafe renderer notice path")
                stream = archive.extractfile(member)
                assert stream is not None
                files[f"wise-flow/{relative.as_posix()}"] = stream.read()
    required = {
        "wise-flow/LICENSE",
        "wise-flow/THIRD_PARTY_NOTICES.md",
        "wise-flow/dist/licenses/bpmn-js.txt",
        "wise-flow/dist/licenses/@xyflow-react.txt",
        "wise-flow/dist/licenses/elkjs.txt",
    }
    missing = required - files.keys()
    if missing:
        raise ValueError(f"vendored renderer is missing attribution: {sorted(missing)}")
    return files


def build_release(frontend_dist: Path, out_dir: Path, *, frontend_mode: str, isolation: bool = True) -> Path:
    if frontend_mode != "live":
        raise ValueError("release builds require an explicit live frontend declaration")
    root = Path(__file__).resolve().parents[1]
    backend = root / "apps" / "backend"
    frontend_dist = frontend_dist.resolve()
    out_dir = out_dir.resolve()
    if not (frontend_dist / "index.html").is_file():
        raise ValueError(f"frontend dist must contain index.html: {frontend_dist}")
    assets = sorted(p for p in frontend_dist.rglob("*") if p.is_file())
    if any(p.is_symlink() for p in frontend_dist.rglob("*")):
        raise ValueError("frontend dist must contain regular files and directories, not symlinks")
    hashes = {p.relative_to(frontend_dist).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in assets}
    notices = attribution_files(root)
    notice_hashes = {name: hashlib.sha256(data).hexdigest() for name, data in notices.items()}
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="wise-release-") as tmp:
        stage = Path(tmp) / "backend"
        stage.mkdir()
        for name in ("pyproject.toml", "README.md"):
            shutil.copy2(backend / name, stage / name)
        for license_file in root.glob("LICENSE*"):
            if license_file.is_file():
                shutil.copy2(license_file, stage / license_file.name)
        shutil.copytree(
            backend / "src",
            stage / "src",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.egg-info", "static"),
        )
        shutil.copytree(frontend_dist, stage / "src" / "wise_workbench" / "static")
        for name, data in notices.items():
            target = stage / "src" / "wise_workbench" / "distribution" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        contract = {
            "frontendMode": frontend_mode,
            "verification": "explicit caller declaration",
        }
        (stage / "src" / "wise_workbench" / "distribution" / "frontend-contract.json").write_text(
            json.dumps(contract, indent=2) + "\n", encoding="utf-8"
        )
        built = Path(tmp) / "wheels"
        command = [sys.executable, "-m", "build", "--wheel", "--outdir", str(built)]
        if not isolation:
            command.append("--no-isolation")
        subprocess.run([*command, str(stage)], check=True)
        (wheel,) = built.glob("*.whl")
        with zipfile.ZipFile(wheel) as archive:
            installed_assets = {
                name.removeprefix("wise_workbench/static/"): hashlib.sha256(archive.read(name)).hexdigest()
                for name in archive.namelist()
                if name.startswith("wise_workbench/static/") and not name.endswith("/")
            }
            if installed_assets != hashes:
                raise RuntimeError("wheel static assets do not exactly match the supplied frontend dist")
            for name, expected in notice_hashes.items():
                if hashlib.sha256(archive.read(f"wise_workbench/distribution/{name}")).hexdigest() != expected:
                    raise RuntimeError(f"wheel attribution differs from its source: {name}")
            if "wise_workbench/migrations/env.py" not in archive.namelist():
                raise RuntimeError("wheel is missing database migrations")
        target = out_dir / wheel.name
        shutil.copy2(wheel, target)
    manifest = {
        "wheel": target.name,
        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "frontend": hashes,
        "frontendContract": contract,
        "attribution": notice_hashes,
    }
    target.with_suffix(".manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend-dist", type=Path, required=True)
    parser.add_argument("--out", "--out-dir", dest="out_dir", type=Path, default=Path("dist"))
    parser.add_argument(
        "--frontend-mode",
        choices=("live",),
        required=True,
        help="explicit declaration that the supplied dist was built with mocks disabled",
    )
    parser.add_argument(
        "--no-isolation",
        action="store_true",
        help="use already installed build dependencies",
    )
    args = parser.parse_args()
    try:
        wheel = build_release(
            args.frontend_dist, args.out_dir, frontend_mode=args.frontend_mode, isolation=not args.no_isolation
        )
    except (ValueError, FileNotFoundError) as exc:
        parser.error(str(exc))
    print(wheel)


if __name__ == "__main__":
    main()
