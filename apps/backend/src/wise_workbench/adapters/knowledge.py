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

import json
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


def stage_lanes(
    process: str | None, *, mapping: str | None = None, variant: str | None = None
) -> dict[str, Any] | None:
    """The pack's stage model in the ``FlowGraph`` shape (``wise_knowledge.stage_lanes``); ``None`` without a pack.

    The BPMN export uses it for ``scope=stages``: lanes become BPMN lanes, canonical activities become tasks and
    the expected orderings become sequence flows.
    """
    if not process:
        return None
    loaded = _load(process)
    if loaded is None:
        return None
    pack = loaded[0]
    try:
        import wise_knowledge as wk

        lanes = wk.stage_lanes(pack, mapping=mapping, variant=variant, only_mapped=bool(mapping))
    except Exception as exc:
        log.warning("stage lanes of %r cannot be built: %s", process, exc)
        return None
    return dict(lanes)


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


def activity_name(process: str | None, activity_id: str, lang: str = "en") -> str | None:
    """The plain name of an activity the pack knows (``o2c.rejection_change`` → *Rejection reason changed*).

    The norm names activities by their canonical id, and a warning that quoted one reached the reader as
    *activity 'o2c.rejection_change' never occurs in the log* (P1-8). ``None`` when the pack does not carry
    the activity, and the caller then keeps whatever the norm wrote.
    """
    if not process or not activity_id:
        return None
    loaded = _load(process)
    if loaded is None:
        return None
    try:
        for a in loaded[0].activities:
            if str(a.id) != activity_id:
                continue
            name = a.name
            if isinstance(name, dict):
                return str(name.get(lang) or name.get("en") or "") or None
            return str(name) or None
    except Exception:
        return None
    return None


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


# ---------------------------------------------------------------------------- knowledge hub (RK-2, RK-3)
def hub_index(process: str | None) -> dict[str, Any] | None:
    """The hub's node and edge tables of a pack; ``None`` without a usable pack."""
    hub = _hub(process) if process else None
    if hub is None:
        return None
    try:
        return dict(hub.index())
    except Exception as exc:  # pragma: no cover - a pack whose graph cannot be built
        log.warning("hub index of %r cannot be built: %s", process, exc)
        return None


def hub_page(process: str | None, node_id: str) -> dict[str, Any] | None:
    """One hub page (node, guidance, related stage, expectations, failure modes, KPIs, playbook, reasons, actions)."""
    hub = _hub(process) if process else None
    if hub is None:
        return None
    try:
        return dict(hub.page(node_id))
    except KeyError:
        return None
    except Exception as exc:  # pragma: no cover
        log.warning("hub page %r of %r cannot be built: %s", node_id, process, exc)
        return None


def hub_node_id(process: str | None, kind: str, entry_id: str, template: str | None = None) -> str | None:
    hub = _hub(process) if process else None
    if hub is None:
        return None
    try:
        node = hub.node_for(kind, entry_id, template)
    except Exception:
        return None
    return str(node) if node else None


# ---------------------------------------------------------------------------- presets of the packs (R1-13, R2-04)
def pack_presets(process: str | None = None) -> list[Any]:
    """Every public-log preset the packs carry (``presets/*.yaml``); empty without the package."""
    try:
        import wise_knowledge as wk
    except ImportError:
        return []
    processes = [process] if process else list(getattr(wk, "PACK_IDS", None) or ("p2p", "o2c"))
    out: list[Any] = []
    for name in processes:
        loaded = _load(str(name))
        if loaded is None:
            continue
        try:
            out.extend(loaded[0].presets.values())
        except Exception as exc:  # pragma: no cover - a pack without presets
            log.warning("presets of %r cannot be read: %s", name, exc)
    return out


def pack_preset(preset_id: str) -> Any | None:
    for preset in pack_presets():
        if str(preset.id) == preset_id:
            return preset
    return None


def template_path(process: str | None, template: str) -> Any | None:
    """The file of a pack template (``templates/<id>.json``), the starting norm of a preset."""
    loaded = _load(process) if process else None
    if loaded is None:
        return None
    pack = loaded[0]
    try:
        entry = next(t for t in pack.templates if str(t.id) == template)
    except (StopIteration, AttributeError):
        return None
    return getattr(entry, "path", None)


ACTIVITY_PARAMS = ("activity", "a", "b", "after", "before", "activities_x", "activities_y")


def label_map(process: str | None, mapping_name: str) -> dict[str, list[str]]:
    """Canonical activity id → the labels a log uses for it, from a curated label pack."""
    loaded = _load(process) if process else None
    if loaded is None:
        return {}
    try:
        entries = loaded[0].mappings[mapping_name].entries
    except Exception as exc:
        log.warning("label pack %r of %r is not available: %s", mapping_name, process, exc)
        return {}
    out: dict[str, list[str]] = {}
    for entry in entries:
        out.setdefault(str(entry.activity), []).append(str(entry.label))
    return out


def translate_norm(
    document: dict[str, Any], process: str | None, mapping_name: str
) -> tuple[dict[str, Any], list[str]]:
    """A template written in canonical activity ids, rewritten in the labels of one log (R2-04).

    The packs' templates name activities by their canonical id (``o2c.goods_issue``) so that one template serves
    every system's vocabulary. A norm has to speak the log's own labels, or nothing matches — and the screens
    have to keep the log's labels, or a reader cannot recognise the process. The template is therefore translated
    once, when the preset creates norm v1, and the norm version stored with the project is the translated one.
    Returns the document and the canonical ids the label pack does not cover.
    """
    labels = label_map(process, mapping_name)
    if not labels:
        return document, []
    out = json.loads(json.dumps(document))
    untranslated: list[str] = []

    def rewrite(values: Any) -> Any:
        items = [values] if isinstance(values, str) else list(values or [])
        result: list[str] = []
        for item in items:
            hit = labels.get(str(item))
            if hit:
                result.extend(hit)
            else:
                if str(item).startswith(f"{process}."):
                    untranslated.append(str(item))
                result.append(str(item))
        return list(dict.fromkeys(result))

    for constraint in out.get("constraints") or []:
        params = constraint.get("params") or {}
        for key in ACTIVITY_PARAMS:
            if params.get(key):
                params[key] = rewrite(params[key])
    for recipe in out.get("derived_attributes") or []:
        for key in ("activities", "activity", "a", "b", "after", "before"):
            if recipe.get(key):
                recipe[key] = rewrite(recipe[key])
    return out, sorted(set(untranslated))


def knowledge_available() -> bool:
    try:
        import wise_knowledge  # noqa: F401
    except ImportError:
        return False
    return True
