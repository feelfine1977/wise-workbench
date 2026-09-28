"""Check the installed core's Git provenance and the module Python actually imports."""

from __future__ import annotations

import argparse
import importlib
import json
import sys
from importlib import metadata
from pathlib import Path

REPOSITORY = "https://github.com/feelfine1977/wise-pm.git"
PROFILES = {
    "classic": ("df5db50b839cc124b489a269894f5a2bfe7dc634", ""),
    "next": ("9c5e6db807ece6f2fe02857082dfd8cd87bf019c", "packages/wise-pm"),
}


class CoreProfileError(RuntimeError):
    """The installed/imported core does not match the requested profile."""


def requirement(core: str) -> str:
    commit, subdirectory = PROFILES[core]
    fragment = f"#subdirectory={subdirectory}" if subdirectory else ""
    return f"wise-pm @ git+{REPOSITORY}@{commit}{fragment}"


def verify(core: str) -> dict[str, str]:
    commit, subdirectory = PROFILES[core]
    try:
        distribution = metadata.distribution("wise-pm")
    except metadata.PackageNotFoundError as exc:
        raise CoreProfileError("wise-pm is not installed in this interpreter") from exc
    raw = distribution.read_text("direct_url.json")
    if not raw:
        raise CoreProfileError("wise-pm has no direct_url.json; install the pinned Git requirement")
    try:
        provenance = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CoreProfileError("wise-pm direct_url.json is not valid JSON") from exc
    if not isinstance(provenance, dict):
        raise CoreProfileError("wise-pm direct_url.json must be an object")
    vcs = provenance.get("vcs_info")
    if not isinstance(vcs, dict) or vcs.get("vcs") != "git":
        raise CoreProfileError("wise-pm must have Git VCS provenance (local/editable installs do not qualify)")
    expected = {
        "repository": (provenance.get("url"), REPOSITORY),
        "commit": (vcs.get("commit_id"), commit),
        "requested revision": (vcs.get("requested_revision"), commit),
        "subdirectory": (provenance.get("subdirectory", ""), subdirectory),
    }
    for field, (actual, wanted) in expected.items():
        if actual != wanted:
            raise CoreProfileError(f"{core} {field} mismatch: expected {wanted!r}, got {actual!r}")

    # Match the import against the distribution's recorded file, not a similarly named checkout.
    recorded = next(
        (file for file in distribution.files or () if str(file) == "wise/__init__.py"),
        None,
    )
    if recorded is None:
        raise CoreProfileError("wise-pm does not record wise/__init__.py in its installed files")
    installed_path = Path(distribution.locate_file(recorded)).resolve()
    try:
        wise = importlib.import_module("wise")
    except Exception as exc:
        raise CoreProfileError(f"wise cannot be imported: {exc}") from exc
    module_file = getattr(wise, "__file__", None)
    if not module_file or Path(module_file).resolve() != installed_path or not installed_path.is_file():
        raise CoreProfileError(f"wise module path mismatch: expected {installed_path}, got {module_file!r}")
    return {
        "core": core,
        "commit": commit,
        "subdirectory": subdirectory,
        "module": str(installed_path),
        "python": sys.executable,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core", choices=tuple(PROFILES), default="classic")
    parser.add_argument(
        "--requirement",
        action="store_true",
        help="print the pinned pip requirement without importing wise",
    )
    args = parser.parse_args()
    if args.requirement:
        print(requirement(args.core))
        return 0
    try:
        result = verify(args.core)
    except CoreProfileError as exc:
        print(f"Core profile verification failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
