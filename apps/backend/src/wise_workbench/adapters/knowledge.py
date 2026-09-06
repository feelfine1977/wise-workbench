"""Optional bridge to the curated knowledge packs (``wise-knowledge``).

The packs give activity labels a canonical id and a stage; the process map
uses the stages as groups. Everything here degrades to ``None`` when the
package or the pack is not available, so the backend never depends on it.

A pack whose optional files (guidance, templates) fail validation still has
usable stages and activity labels: the validated load is tried first and an
unvalidated load second, so the map keeps its stage groups while a pack is
being edited; a warning names the reason.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Any

MIN_CONFIDENCE = 0.6

log = logging.getLogger(__name__)


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
    validated: bool = True  # False when the pack loaded only without validation

    def stage_of(self, label: str) -> str | None:
        m = self.matches.get(label)
        return m.stage if m else None


_lock = threading.Lock()
_packs: dict[str, Any] = {}
_matchers: dict[str, Any] = {}
_validated: dict[str, bool] = {}
_hubs: dict[str, Any] = {}


def _load_pack(wk: Any, process: str) -> tuple[Any, bool] | None:
    """The pack, validated when possible; ``(pack, False)`` after a fallback; ``None`` when unusable."""
    try:
        return wk.load_pack(process), True
    except Exception as exc:
        reason = str(exc).splitlines()[0][:200] if str(exc) else type(exc).__name__
    try:
        pack = wk.load_pack(process, validate=False)
    except Exception:
        log.warning("knowledge pack %r is not loadable: %s", process, reason)
        return None
    log.warning("knowledge pack %r fails validation, using it without validation: %s", process, reason)
    return pack, False


def _load(process: str) -> tuple[Any, Any, bool] | None:
    try:
        import wise_knowledge as wk
    except ImportError:
        return None
    with _lock:
        if process not in _packs:
            loaded = _load_pack(wk, process)
            if loaded is None:
                _packs[process] = None
                _matchers[process] = None
                _validated[process] = False
                return None
            pack, validated = loaded
            try:
                matcher = wk.Matcher(pack)
            except Exception as exc:
                log.warning("knowledge pack %r has no usable matcher: %s", process, exc)
                _packs[process] = None
                _matchers[process] = None
                _validated[process] = False
                return None
            _packs[process] = pack
            _matchers[process] = matcher
            _validated[process] = validated
    pack = _packs[process]
    return (pack, _matchers[process], _validated[process]) if pack is not None else None


def reset_cache() -> None:
    """Forget loaded packs (tests, or after a pack changed on disk)."""
    with _lock:
        _packs.clear()
        _matchers.clear()
        _validated.clear()
        _hubs.clear()


def _hub(process: str) -> Any | None:
    """The pack's knowledge hub (built once per process); ``None`` when unavailable."""
    loaded = _load(process)
    if loaded is None:
        return None
    with _lock:
        if process not in _hubs:
            try:
                import wise_knowledge as wk

                _hubs[process] = wk.build_hub(loaded[0])
            except Exception as exc:
                log.warning("knowledge hub of %r cannot be built: %s", process, exc)
                _hubs[process] = None
        return _hubs[process]


def stage_model(process: str | None, labels: list[str]) -> StageModel | None:
    """Stages of a pack plus the stage of every matched label; ``None`` without a usable pack."""
    if not process:
        return None
    loaded = _load(process)
    if loaded is None:
        return None
    pack, matcher, validated = loaded
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
    return StageModel(process=process, stages=stages, matches=matches, validated=validated)


def case_noun(process: str | None, lang: str = "en") -> str | None:
    """The pack's business name of a case ("purchase order items"); ``None`` without a usable pack."""
    if not process:
        return None
    loaded = _load(process)
    if loaded is None:
        return None
    pack = loaded[0]
    try:
        noun = pack.stage_model.noun
    except Exception:
        return None
    if isinstance(noun, dict):
        return str(noun.get(lang) or noun.get("en") or "") or None
    return str(noun) or None


@dataclass(frozen=True)
class GuidanceRef:
    """Plain names of one layer or constraint from the pack's generic guidance tier."""

    kind: str
    id: str
    plain_name: str | None
    missed_label: str | None
    hub_node: str | None
    block: dict[str, Any] | None


def _from_norm_metadata(document: dict[str, Any] | None, kind: str, entry_id: str) -> dict[str, Any] | None:
    """``metadata.guidance`` embedded in a norm (the knowledge package's ``embed-guidance``)."""
    if not document:
        return None
    guidance = (document.get("metadata") or {}).get("guidance") or {}
    section = guidance.get("layers" if kind == "layer" else "constraints") or {}
    block = section.get(entry_id)
    return dict(block) if isinstance(block, dict) else None


def guidance_ref(
    process: str | None,
    kind: str,
    entry_id: str,
    *,
    document: dict[str, Any] | None = None,
    template: str | None = None,
) -> GuidanceRef:
    """The plain name, the missed label and the hub node of a layer or constraint.

    The norm's own ``metadata.guidance`` is read first (it travels with the
    norm version), then the pack's generic tier; without either the result
    carries ``None`` names so that the caller falls back to the norm's text.
    """
    block = _from_norm_metadata(document, kind, entry_id)
    if block is None and process:
        loaded = _load(process)
        if loaded is not None:
            pack = loaded[0]
            try:
                g = pack.guidance_for(kind, entry_id, template=template)
            except Exception:
                g = None
            if g is not None:
                try:
                    block = g.as_block()
                except Exception:
                    block = {"plain_name": g.plain_name_en, "missed_label": g.missed_label_en}
    if block is None:
        return GuidanceRef(kind, entry_id, None, None, None, None)
    hub = block.get("hub_node")
    if not hub and process:
        hub_obj = _hub(process)
        if hub_obj is not None:
            try:
                hub = hub_obj.node_for(kind, entry_id, template)
            except Exception:
                hub = None
    return GuidanceRef(
        kind,
        entry_id,
        str(block.get("plain_name")) if block.get("plain_name") else None,
        str(block.get("missed_label")) if block.get("missed_label") else None,
        str(hub) if hub else None,
        block,
    )


def guidance_complete(process: str | None, document: dict[str, Any]) -> bool:
    """True when every layer and constraint of the norm has a plain name from guidance."""
    layers = [str(layer.get("id")) for layer in document.get("layers") or []]
    constraints = [str(c.get("id")) for c in document.get("constraints") or []]
    if not layers and not constraints:
        return False
    for lid in layers:
        if guidance_ref(process, "layer", lid, document=document).plain_name is None:
            return False
    for cid in constraints:
        if guidance_ref(process, "constraint", cid, document=document).plain_name is None:
            return False
    return True


def knowledge_available() -> bool:
    try:
        import wise_knowledge  # noqa: F401
    except ImportError:
        return False
    return True
