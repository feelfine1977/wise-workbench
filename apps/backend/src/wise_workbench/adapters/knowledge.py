"""Optional bridge to the curated knowledge packs (``wise-knowledge``).

The packs give activity labels a canonical id and a stage; the process map
uses the stages as groups. Everything here degrades to ``None`` when the
package or the pack is not available, so the backend never depends on it.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

MIN_CONFIDENCE = 0.6


@dataclass(frozen=True)
class StageMatch:
    label: str
    activity_id: str
    stage: str
    confidence: float
    tier: str


@dataclass(frozen=True)
class StageModel:
    process: str
    stages: tuple[dict[str, Any], ...]  # ordered: {"id", "label", "order"}
    matches: dict[str, StageMatch]  # label → match (confidence ≥ MIN_CONFIDENCE)

    def stage_of(self, label: str) -> str | None:
        m = self.matches.get(label)
        return m.stage if m else None


_lock = threading.Lock()
_packs: dict[str, Any] = {}
_matchers: dict[str, Any] = {}


def _load(process: str) -> tuple[Any, Any] | None:
    try:
        import wise_knowledge as wk
    except ImportError:
        return None
    with _lock:
        if process not in _packs:
            try:
                pack = wk.load_pack(process)
            except Exception:
                _packs[process] = None
                _matchers[process] = None
                return None
            _packs[process] = pack
            _matchers[process] = wk.Matcher(pack)
    pack = _packs[process]
    return (pack, _matchers[process]) if pack is not None else None


def stage_model(process: str | None, labels: list[str]) -> StageModel | None:
    """Stages of a pack plus the stage of every matched label; ``None`` without a usable pack."""
    if not process:
        return None
    loaded = _load(process)
    if loaded is None:
        return None
    pack, matcher = loaded
    stages = tuple(
        {"id": s.id, "label": s.name.get("en", s.id), "order": int(s.order)}
        for s in sorted(pack.stages, key=lambda s: s.order)
    )
    matches: dict[str, StageMatch] = {}
    for label in labels:
        try:
            candidates = matcher.match(label)
        except Exception:
            continue
        if not candidates:
            continue
        best = candidates[0]
        if best.confidence >= MIN_CONFIDENCE:
            matches[label] = StageMatch(label, best.activity_id, best.stage, float(best.confidence), best.tier)
    return StageModel(process=process, stages=stages, matches=matches)


def knowledge_available() -> bool:
    try:
        import wise_knowledge  # noqa: F401
    except ImportError:
        return False
    return True
