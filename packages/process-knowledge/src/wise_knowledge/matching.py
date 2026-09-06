"""Lexical activity canonicalisation (journey stage S2, feature F33).

Pipeline per observed label (optionally with lifecycle, document type and
sub-process as parts of the key):

1. normalisation — case, separators, umlauts, SAP transaction codes,
   abbreviations, light stemming, stop words;
2. exact hits — system label packs (confidence 1.0), transaction codes
   (0.97), canonical names and synonyms in English or German (0.95);
3. token overlap — Dice and containment over stemmed tokens, with a penalty
   when a *marker* token (cancel, change, block, ...) is present on one side
   only, so that "Goods receipt" prefers *Record Goods Receipt* over *Cancel
   Goods Receipt*;
4. fuzzy ratio — ``rapidfuzz`` when installed, ``difflib`` otherwise; ratios
   below ``FUZZY_FLOOR`` count as no evidence.

The result is a ranked candidate list with confidence, tier and stage; the
analyst confirms in the mapping screen. Embedding candidates are outside
this package.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from .models import Activity, LabelEntry, Mapping, Pack

try:  # optional
    from rapidfuzz import fuzz as _fuzz

    def _ratio(a: str, b: str) -> float:
        return float(_fuzz.token_set_ratio(a, b)) / 100.0

    FUZZY_BACKEND = "rapidfuzz"
except ImportError:  # pragma: no cover - exercised only without rapidfuzz
    from difflib import SequenceMatcher

    def _ratio(a: str, b: str) -> float:
        return SequenceMatcher(None, a, b).ratio()

    FUZZY_BACKEND = "difflib"


KEY_COMPONENTS = ("lifecycle", "document_type", "subprocess")
#: fuzzy ratios below this floor carry no evidence (they occur between unrelated labels)
FUZZY_FLOOR = 0.72

ABBREVIATIONS: dict[str, str] = {
    "po": "purchase order",
    "pr": "purchase requisition",
    "preq": "purchase requisition",
    "gr": "goods receipt",
    "ir": "invoice receipt",
    "ses": "service entry sheet",
    "inv": "invoice",
    "qty": "quantity",
    "mat": "material",
    "avail": "availability",
    "conf": "confirmation",
    "syst": "system",
    "sys": "system",
    "rfq": "request for quotation",
    "pgi": "post goods issue",
    "gi": "goods issue",
    "dlv": "delivery",
    "pmt": "payment",
    "pymt": "payment",
    "vend": "vendor",
    "cust": "customer",
    "doc": "document",
    "acc": "according",
    "so": "sales order",
    "sd": "sales",
    "mm": "purchasing",
}

STOP_WORDS = frozenset(
    {
        "the",
        "a",
        "an",
        "of",
        "for",
        "to",
        "in",
        "on",
        "and",
        "or",
        "with",
        "by",
        "was",
        "is",
        "be",
        "at",
        "from",
        "into",
        "per",
        "according",
        "acc",
    }
)

# tokens whose presence on one side only flips the meaning of a label
# (cancel vs record, header vs item, approve vs create); ordinary nouns are
# left to the overlap measures
MARKER_STEMS = frozenset(
    {
        "cancel",
        "revers",
        "delet",
        "block",
        "unblock",
        "chang",
        "remov",
        "fail",
        "reject",
        "return",
        "credit",
        "debit",
        "subsequent",
        "hold",
        "incomplet",
        "updat",
        "set",
        "releas",
        "reactiv",
        "withdraw",
        "postpon",
        "prepon",
        "deleg",
        "approv",
        "await",
        "transmit",
        "transfer",
        "not",
        "no",
        "without",
        "dun",
        "remind",
        "correct",
        "split",
        "partial",
        "manual",
        "reorder",
        "final",
        "item",
        "send",
        "header",
    }
)

_TCODE_LIST = frozenset(
    {
        "migo",
        "miro",
        "mrbr",
        "mr8m",
        "ml81n",
        "mbst",
        "mb1c",
        "mb01",
        "vkm1",
        "vkm3",
        "vkm4",
        "v_v2",
        "me9f",
        "fb60",
        "fbl1n",
        "f110",
        "f150",
        "f-28",
        "f-53",
        "me2n",
        "me2l",
        "me2m",
        "me51n",
        "me52n",
        "me53n",
        "me54n",
        "me55",
        "me21n",
        "me22n",
        "me23n",
        "me28",
        "me29n",
        "me41",
        "me47",
        "va01",
        "va02",
        "va05",
        "va11",
        "va21",
        "vl01n",
        "vl02n",
        "vl06o",
        "vl09",
        "vl10",
        "lt03",
        "vf01",
        "vf02",
        "vf04",
        "vf11",
        "fbl5n",
        "f-32",
        "mb51",
    }
)
_TCODE_RE = re.compile(r"^(?:[a-z]{1,2}\d{2,3}[a-z]?|f[-.]\d{2}|[a-z]_[a-z]\d)$")
_SPLIT_RE = re.compile(r"[\s_\-/:;,.()\[\]{}<>|\"'`+*=&#!?]+")
_CAMEL_RE = re.compile(r"(?<=[a-z])(?=[A-Z])")


def strip_accents(text: str) -> str:
    text = (
        text.replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("ß", "ss")
        .replace("Ä", "Ae")
        .replace("Ö", "Oe")
        .replace("Ü", "Ue")
    )
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def is_tcode(token: str) -> bool:
    t = token.lower()
    return t in _TCODE_LIST or bool(_TCODE_RE.match(t))


_IRREGULAR = {
    "approval": "approv",
    "removal": "remov",
    "reversal": "revers",
    "paid": "pay",
    "held": "hold",
    "sent": "send",
    "cancellation": "cancel",
    "cancelled": "cancel",
    "canceled": "cancel",
    "goods": "good",
}


def stem(token: str) -> str:
    """A deliberately small suffix stripper applied to both sides of every comparison."""
    if token in _IRREGULAR:
        return _IRREGULAR[token]
    t = token
    for suffix in ("ations", "ation", "ings", "ing", "ions", "ion", "ies", "ed", "es", "s"):
        if t.endswith(suffix) and len(t) - len(suffix) >= 3:
            t = t[: -len(suffix)]
            if suffix == "ies":
                t += "i"
            break
    if t.endswith("e") and len(t) > 3:
        t = t[:-1]
    if t.endswith("y") and len(t) > 3:
        t = t[:-1] + "i"
    return t


def tokenise(text: str) -> tuple[list[str], list[str]]:
    """Return (stemmed tokens without stop words and transaction codes, transaction codes found)."""
    text = strip_accents(_CAMEL_RE.sub(" ", text))
    raw = [t for t in _SPLIT_RE.split(text.lower()) if t]
    tokens: list[str] = []
    tcodes: list[str] = []
    for t in raw:
        if is_tcode(t):
            tcodes.append(t)
            continue
        if t in ABBREVIATIONS:
            tokens.extend(ABBREVIATIONS[t].split())
            continue
        if t in STOP_WORDS:
            continue
        tokens.append(t)
    return [stem(t) for t in tokens], tcodes


def normalise_label(text: str) -> str:
    """The normalised form used for exact comparisons."""
    tokens, _ = tokenise(text)
    return " ".join(tokens)


# --------------------------------------------------------------------------- observed keys
@dataclass(frozen=True)
class MatchKey:
    """Which columns form the activity key (docs/DATASETS.md §5.1)."""

    label: str = "activity"
    lifecycle: str | None = None
    document_type: str | None = None
    subprocess: str | None = None

    def columns(self) -> list[str]:
        return [c for c in (self.label, self.lifecycle, self.document_type, self.subprocess) if c]

    def components(self) -> dict[str, str]:
        return {
            k: v
            for k, v in (
                ("lifecycle", self.lifecycle),
                ("document_type", self.document_type),
                ("subprocess", self.subprocess),
            )
            if v
        }


@dataclass(frozen=True)
class ObservedActivity:
    label: str
    lifecycle: str | None = None
    document_type: str | None = None
    subprocess: str | None = None
    count: int = 0

    @property
    def key_text(self) -> str:
        parts = [self.label]
        if self.lifecycle:
            parts.append(f"[{self.lifecycle}]")
        if self.document_type:
            parts.append(f"{{{self.document_type}}}")
        if self.subprocess:
            parts.append(f"/{self.subprocess}")
        return " ".join(parts)

    def component(self, name: str) -> str | None:
        return getattr(self, name)


@dataclass(frozen=True)
class Candidate:
    activity_id: str
    name: str
    stage: str
    confidence: float
    method: str
    matched_text: str
    tier: str

    def as_row(self) -> dict[str, Any]:
        return {
            "activity_id": self.activity_id,
            "name": self.name,
            "stage": self.stage,
            "confidence": round(self.confidence, 3),
            "tier": self.tier,
            "method": self.method,
            "matched_text": self.matched_text,
        }


@dataclass(frozen=True)
class MatchResult:
    observed: ObservedActivity
    candidates: tuple[Candidate, ...]

    @property
    def best(self) -> Candidate | None:
        return self.candidates[0] if self.candidates else None

    @property
    def status(self) -> str:
        return self.best.tier if self.best else "unmatched"


@dataclass
class Evaluation:
    n: int
    top1: int
    top3: int
    misses: list[dict[str, Any]] = field(default_factory=list)

    @property
    def top1_rate(self) -> float:
        return self.top1 / self.n if self.n else 0.0

    @property
    def top3_rate(self) -> float:
        return self.top3 / self.n if self.n else 0.0


@dataclass(frozen=True)
class _Text:
    """One comparable string of an activity with its origin."""

    activity: Activity
    text: str
    norm: str
    tokens: frozenset[str]
    tcodes: frozenset[str]
    method: str
    entry: LabelEntry | None = None


def tier_of(confidence: float) -> str:
    if confidence >= 0.85:
        return "high"
    if confidence >= 0.6:
        return "medium"
    if confidence > 0:
        return "low"
    return "unmatched"


def _dice(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    return 2 * len(a & b) / (len(a) + len(b))


def _containment(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def _marker_penalty(a: frozenset[str], b: frozenset[str]) -> float:
    only = (a ^ b) & MARKER_STEMS
    if not only:
        return 1.0
    return 0.7 ** len(only)


class Matcher:
    """Match observed labels to the canonical activities of one pack."""

    def __init__(
        self,
        pack: Pack,
        label_packs: Iterable[str] | None = None,
        key: MatchKey | None = None,
        top_k: int = 5,
        min_confidence: float = 0.3,
    ) -> None:
        self.pack = pack
        self.key = key or MatchKey()
        self.top_k = top_k
        self.min_confidence = min_confidence
        if label_packs is None:
            self.label_packs = list(pack.label_packs)
        else:
            unknown = set(label_packs) - set(pack.label_packs)
            if unknown:
                raise KeyError(f"unknown label packs {sorted(unknown)}; available {sorted(pack.label_packs)}")
            self.label_packs = list(label_packs)
        self._texts = self._index()
        self._stage_order = {s.id: s.order for s in pack.stage_model.stages}

    # ------------------------------------------------------------------ index
    def _index(self) -> list[_Text]:
        texts: list[_Text] = []
        by_id = {a.id: a for a in self.pack.activities}

        def add(activity: Activity, text: str, method: str, entry: LabelEntry | None = None) -> None:
            tokens, tcodes = tokenise(text)
            texts.append(_Text(activity, text, " ".join(tokens), frozenset(tokens), frozenset(tcodes), method, entry))

        for a in self.pack.activities:
            add(a, a.name_en, "name")
            for lang, syns in a.synonyms.items():
                for s in syns:
                    add(a, s, f"synonym:{lang}")
            for code in a.tcodes:
                add(a, code, "tcode")
        for name in self.label_packs:
            lp = self.pack.label_packs[name]
            for e in lp.labels:
                add(by_id[e.activity], e.label, f"label_pack:{name}", e)
                if e.tcode:
                    add(by_id[e.activity], e.tcode, f"tcode:{name}", e)
        return texts

    # ------------------------------------------------------------------ scoring
    @staticmethod
    def _key_factor(entry: LabelEntry | None, observed: ObservedActivity) -> float | None:
        """None when the key components contradict; 1.0 when they agree; 0.9 when the entry is stricter."""
        if entry is None:
            return 1.0
        factor = 1.0
        for comp in KEY_COMPONENTS:
            want = getattr(entry, comp)
            have = observed.component(comp)
            if want is None:
                continue
            if have is None:
                factor = min(factor, 0.9)
            elif have.strip().lower() != want.strip().lower():
                return None
        return factor

    def _score(
        self,
        observed: ObservedActivity,
        obs_norm: str,
        obs_tokens: frozenset[str],
        obs_tcodes: frozenset[str],
        t: _Text,
    ) -> float:
        factor = self._key_factor(t.entry, observed)
        if factor is None:
            return 0.0
        if t.method.startswith("tcode"):
            return 0.97 * factor if (t.tcodes and t.tcodes <= obs_tcodes) else 0.0
        if obs_norm and obs_norm == t.norm:
            base = 1.0 if t.method.startswith("label_pack") else 0.95
            return base * factor
        if not obs_tokens or not t.tokens:
            return 0.0
        penalty = _marker_penalty(obs_tokens, t.tokens)
        overlap = (0.5 * _dice(obs_tokens, t.tokens) + 0.5 * _containment(obs_tokens, t.tokens)) * penalty
        ratio = _ratio(obs_norm, t.norm)
        fuzzy = ratio * 0.9 * penalty if ratio >= FUZZY_FLOOR else 0.0
        return min(0.9, max(overlap, fuzzy)) * factor

    def match(self, observed: ObservedActivity | str) -> list[Candidate]:
        if isinstance(observed, str):
            observed = ObservedActivity(label=observed)
        obs_tokens_list, obs_tcodes_list = tokenise(observed.label)
        obs_norm = " ".join(obs_tokens_list)
        obs_tokens, obs_tcodes = frozenset(obs_tokens_list), frozenset(obs_tcodes_list)
        best: dict[str, tuple[float, _Text]] = {}
        for t in self._texts:
            s = self._score(observed, obs_norm, obs_tokens, obs_tcodes, t)
            if s <= 0:
                continue
            cur = best.get(t.activity.id)
            if cur is None or s > cur[0] or (s == cur[0] and len(t.tokens) < len(cur[1].tokens)):
                best[t.activity.id] = (s, t)
        ranked = sorted(
            best.items(),
            key=lambda kv: (-kv[1][0], len(kv[1][1].tokens), self._stage_order.get(kv[1][1].activity.stage, 99), kv[0]),
        )
        out = []
        for aid, (s, t) in ranked[: self.top_k]:
            if s < self.min_confidence:
                continue
            out.append(
                Candidate(
                    activity_id=aid,
                    name=t.activity.name_en,
                    stage=t.activity.stage,
                    confidence=s,
                    method=t.method,
                    matched_text=t.text,
                    tier=tier_of(s),
                )
            )
        return out

    def match_many(self, observed: Iterable[ObservedActivity | str]) -> list[MatchResult]:
        results = []
        for o in observed:
            obs = ObservedActivity(label=o) if isinstance(o, str) else o
            results.append(MatchResult(observed=obs, candidates=tuple(self.match(obs))))
        return results

    # ------------------------------------------------------------------ evaluation
    def evaluate(
        self, oracle: Mapping | dict[str, str], observed: Iterable[ObservedActivity] | None = None
    ) -> Evaluation:
        """Top-1 and top-3 agreement with a curated mapping."""
        if isinstance(oracle, Mapping):
            entries = {(e.label, e.lifecycle, e.document_type, e.subprocess): e.activity for e in oracle.entries}
        else:
            entries = {(label, None, None, None): aid for label, aid in oracle.items()}
        if observed is None:
            observed = [
                ObservedActivity(label=k[0], lifecycle=k[1], document_type=k[2], subprocess=k[3]) for k in entries
            ]
        ev = Evaluation(n=0, top1=0, top3=0)
        for obs in observed:
            expected = entries.get((obs.label, obs.lifecycle, obs.document_type, obs.subprocess)) or entries.get(
                (obs.label, None, None, None)
            )
            if expected is None:
                continue
            ev.n += 1
            cands = self.match(obs)
            ids = [c.activity_id for c in cands]
            if ids and ids[0] == expected:
                ev.top1 += 1
            if expected in ids[:3]:
                ev.top3 += 1
            if not ids or ids[0] != expected:
                ev.misses.append(
                    {
                        "label": obs.key_text,
                        "expected": expected,
                        "got": ids[0] if ids else None,
                        "confidence": cands[0].confidence if cands else 0.0,
                    }
                )
        return ev


__all__ = [
    "ABBREVIATIONS",
    "FUZZY_BACKEND",
    "Candidate",
    "Evaluation",
    "MatchKey",
    "MatchResult",
    "Matcher",
    "ObservedActivity",
    "normalise_label",
    "stem",
    "tier_of",
    "tokenise",
]
