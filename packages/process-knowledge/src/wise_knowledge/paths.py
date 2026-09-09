"""Installed schemas and packs, with an explicit WISE_KNOWLEDGE_ROOT override.

Content has one source: ``wise_knowledge/data``. Resource extraction (when a
loader needs it) lives until process exit because Pack/Template objects expose
filesystem paths. Third-party packs use the ``wise_knowledge.packs`` entry points.
"""

from __future__ import annotations

import atexit
import os
import sys
from contextlib import ExitStack
from functools import cache
from importlib import metadata

if sys.version_info >= (3, 12):
    from importlib.resources import as_file, files
else:
    from importlib_resources import as_file, files
from pathlib import Path

ENV_ROOT = "WISE_KNOWLEDGE_ROOT"
ENTRY_POINT_GROUP = "wise_knowledge.packs"
PACK_FILES = ("ontology", "stages", "failure_modes", "kpis", "glossary", "playbooks", "slicing")
GUIDANCE_FILE = "guidance"  # optional for third-party packs; required once a pack ships templates
PRESETS_DIR = "presets"


_RESOURCE_CONTEXTS = ExitStack()
atexit.register(_RESOURCE_CONTEXTS.close)


@cache
def _installed_root() -> Path:
    return _RESOURCE_CONTEXTS.enter_context(as_file(files("wise_knowledge").joinpath("data")))


def knowledge_root() -> Path:
    """Directory holding ``schema/`` and the pack folders."""
    env = os.environ.get(ENV_ROOT)
    if env:
        root = Path(env).expanduser().resolve()
        if not (root / "schema").is_dir():
            raise FileNotFoundError(f"{ENV_ROOT}={root} has no schema/ directory")
        return root
    return _installed_root()


def schema_dir() -> Path:
    return knowledge_root() / "schema"


def is_pack_dir(path: Path) -> bool:
    return all((path / f"{name}.yaml").is_file() for name in PACK_FILES)


def preset_files(pack_path: Path) -> list[Path]:
    d = pack_path / PRESETS_DIR
    return sorted(d.glob("*.yaml")) if d.is_dir() else []


def builtin_packs() -> dict[str, Path]:
    root = knowledge_root()
    return {p.name: p for p in sorted(root.iterdir()) if p.is_dir() and is_pack_dir(p)}


def entry_point_packs() -> dict[str, Path]:
    found: dict[str, Path] = {}
    try:
        eps = metadata.entry_points(group=ENTRY_POINT_GROUP)
    except Exception:  # pragma: no cover - importlib quirks on old interpreters
        return found
    for ep in eps:
        try:
            target = ep.load()
        except Exception:
            continue
        path = Path(target() if callable(target) else target)
        if is_pack_dir(path):
            found[ep.name] = path
    return found


def available_packs() -> dict[str, Path]:
    """Built-in packs first, then packs registered through entry points."""
    packs = builtin_packs()
    for name, path in entry_point_packs().items():
        packs.setdefault(name, path)
    return packs


def pack_dir(name_or_path: str | Path) -> Path:
    """Resolve a pack name (``p2p``) or a directory to the pack directory."""
    path = Path(name_or_path)
    if path.is_dir() and is_pack_dir(path):
        return path.resolve()
    packs = available_packs()
    if str(name_or_path) in packs:
        return packs[str(name_or_path)]
    raise FileNotFoundError(f"unknown pack {name_or_path!r}; available: {sorted(packs)}")
