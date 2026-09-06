"""Synthetic purchase-to-pay logs with planted hotspots and artefacts.

:func:`generate` builds a P2P-like event log that the paper's running norm
(:func:`wise.running_p2p_norm`) scores directly: the five activities
*Create Purchase Order Item*, *Record Goods Receipt*, *Record Invoice
Receipt*, *Clear Invoice* and *Cancel Invoice Receipt*, the case
attributes ``flow_type``, ``company``, ``spend_area``, ``vendor`` and
``document`` (the purchasing document a case belongs to), an event amount
and a ``net_worth`` exposure.

Hotspots plant a mechanism into a slice; artefacts plant data problems.
Both are returned as :class:`GroundTruth` next to the log, so that tests
and the evaluation harness can check what an analytic recovered.

Mechanisms and the constraint of the running norm they load:

==================  ==========  =====================================================
mechanism           constraint  what changes in the slice
==================  ==========  =====================================================
``lag``             ``c2``      GR → INV lag multiplied by ``strength``
``missing_invoice`` ``c1``      invoice missing with probability ``strength``
                                (by construction also ``c2`` and ``c3``)
``fragmentation``   ``c5``      ``strength`` extra goods-receipt events
``mismatch``        ``c3``      large invoice/receipt mismatch with probability ``strength``
``cancellation``    ``c6``      invoice cancelled with probability ``strength``
==================  ==========  =====================================================

Artefacts (``artefacts={name: value}``):

``censoring`` (share of cases)
    cases started shortly before the window end whose later events fall
    beyond it and are dropped (a right-truncated window),
``replication`` (share of cases)
    every event of the case appears three times at the same timestamp
    (header-level postings replicated per item),
``sentinel_dates`` (share of events)
    timestamps replaced by ``1900-01-01`` or ``2099-12-31``,
``duplicates`` (share of events)
    exact copies of events appended,
``precision_mix`` (share of events of one activity)
    timestamps truncated to the date for part of the invoice receipts,
``vocabulary_drift`` (``True`` or a mapping with ``from``, ``activity``, ``new_label``)
    the invoice-receipt label renamed from 92 days before the last event on,
``unit_mixing`` (company id)
    exposure of that company multiplied by 1000 (a currency-unit mix).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

import numpy as np
import pandas as pd
import wise

PO = "Create Purchase Order Item"
GR = "Record Goods Receipt"
INV = "Record Invoice Receipt"
CLR = "Clear Invoice"
CINV = "Cancel Invoice Receipt"

CASE_ATTRIBUTES = ("flow_type", "company", "spend_area", "vendor", "document")

MECHANISMS: dict[str, tuple[str, ...]] = {
    "lag": ("c2",),
    "missing_invoice": ("c1", "c2", "c3"),
    "fragmentation": ("c5",),
    "mismatch": ("c3",),
    "cancellation": ("c6",),
}

DEFAULT_HOTSPOTS: tuple[dict[str, Any], ...] = (
    {"where": {"company": "C2", "spend_area": "Packaging"}, "mechanism": "lag", "strength": 3.0},
    {"where": {"vendor": "V007"}, "mechanism": "missing_invoice", "strength": 0.35},
    {"where": {"company": "C3", "spend_area": "Logistics"}, "mechanism": "fragmentation", "strength": 2.0},
)

DEFAULT_ARTEFACTS: dict[str, Any] = {
    "censoring": 0.15,
    "replication": 0.10,
    "sentinel_dates": 0.01,
    "duplicates": 0.01,
    "precision_mix": 0.30,
    "vocabulary_drift": True,
    "unit_mixing": "C3",
}

DEFAULT_PARAMS: dict[str, Any] = {
    "window": ("2023-01-01", "2024-12-31"),
    "companies": (("C1", 0.5), ("C2", 0.3), ("C3", 0.2)),
    "spend_areas": (("Packaging", 0.25), ("Logistics", 0.2), ("Raw materials", 0.25), ("Services", 0.2), ("IT", 0.1)),
    "flow_types": (("DF1", 0.6), ("DF2", 0.4)),
    "n_vendors": 40,
    "items_per_document": 1.5,  # Poisson mean of extra items per purchasing document
    "gr_lag_median_days": 7.0,
    "gr_lag_sigma": 0.5,
    "inv_lag_median_days": 6.0,
    "inv_lag_sigma": 0.6,
    "clr_lag_median_days": 20.0,
    "clr_lag_sigma": 0.4,
    "gr_count_probs": (0.80, 0.12, 0.05, 0.02, 0.01),
    "missing_invoice_rate": 0.03,
    "mismatch_rate": 0.05,
    "po_mismatch_rate": 0.05,
    "cancellation_rate": 0.04,
    "net_worth_median": 2000.0,
    "net_worth_sigma": 1.2,
    "batch_share": 0.15,  # share of events posted by a batch user
}


@dataclass(frozen=True)
class Hotspot:
    """A planted mechanism in a slice."""

    where: Mapping[str, Any]
    mechanism: str
    strength: float
    constraints: tuple[str, ...]
    n_cases: int
    case_ids: tuple[str, ...] = field(repr=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "where", MappingProxyType(dict(self.where)))

    @property
    def constraint(self) -> str:
        """The constraint the mechanism loads first."""
        return self.constraints[0]

    def label(self) -> str:
        return ", ".join(f"{k}={v}" for k, v in self.where.items())


@dataclass(frozen=True)
class GroundTruth:
    """What was planted: hotspots, artefacts with their evidence, the norm and the window."""

    template: str
    n_cases: int
    seed: int
    params: Mapping[str, Any]
    hotspots: tuple[Hotspot, ...]
    artefacts: Mapping[str, Mapping[str, Any]]
    norm: wise.Norm
    window: tuple[pd.Timestamp, pd.Timestamp]

    def __post_init__(self) -> None:
        object.__setattr__(self, "params", MappingProxyType(dict(self.params)))
        object.__setattr__(self, "artefacts", MappingProxyType({k: MappingProxyType(dict(v)) for k, v in self.artefacts.items()}))

    def hotspot_for(self, constraint: str) -> Hotspot | None:
        for h in self.hotspots:
            if constraint in h.constraints:
                return h
        return None


def _choice(rng: np.random.Generator, items: Sequence[tuple[str, float]], n: int) -> np.ndarray:
    labels = np.array([k for k, _ in items], dtype=object)
    p = np.array([w for _, w in items], dtype=float)
    return rng.choice(labels, size=n, p=p / p.sum())


def _mask(cases: pd.DataFrame, where: Mapping[str, Any]) -> np.ndarray:
    m = np.ones(len(cases), dtype=bool)
    for k, v in where.items():
        if k not in cases.columns:
            raise KeyError(f"hotspot refers to unknown case attribute {k!r}")
        col = cases[k].to_numpy()
        m &= np.isin(col, list(v)) if isinstance(v, list | tuple | set) else (col == v)
    return m


def _timestamps(start: pd.Timestamp, days: np.ndarray) -> np.ndarray:
    return (start + pd.to_timedelta(np.round(days * 86400.0), unit="s")).to_numpy("datetime64[ns]")


def generate(
    template: str = "p2p",
    n_cases: int = 3000,
    seed: int = 0,
    *,
    hotspots: Sequence[Mapping[str, Any]] | None = None,
    artefacts: Mapping[str, Any] | None = None,
    params: Mapping[str, Any] | None = None,
    scoring_mode: str | None = None,
    explicit_window: bool = False,
) -> tuple[wise.EventLog, GroundTruth]:
    """Generate a synthetic P2P log with planted hotspots and artefacts.

    Parameters
    ----------
    template
        Only ``"p2p"`` for now.
    n_cases, seed
        Size and random seed (the output is a pure function of both).
    hotspots
        Mappings with ``where`` (case attribute → value), ``mechanism`` and
        ``strength``; ``None`` plants :data:`DEFAULT_HOTSPOTS`, ``()`` none.
    artefacts
        ``{name: value}`` as in the module docstring; ``None`` plants none.
    params
        Overrides of :data:`DEFAULT_PARAMS`.
    scoring_mode
        Scoring mode of the returned norm (default: the running norm's ``flat``).
    explicit_window
        Attach the generating window to the log (``EventLog(window=...)``).

    Returns
    -------
    ``(log, truth)`` — the :class:`wise.EventLog` and the :class:`GroundTruth`
    (its ``norm`` is the running norm of the paper, optionally with another
    scoring mode).
    """
    if template != "p2p":
        raise ValueError(f"unknown template {template!r}; available: 'p2p'")
    if n_cases < 1:
        raise ValueError("n_cases must be >= 1")
    p = {**DEFAULT_PARAMS, **(params or {})}
    hs = list(DEFAULT_HOTSPOTS) if hotspots is None else list(hotspots)
    art = dict(artefacts or {})
    rng = np.random.default_rng(seed)
    start, end = pd.Timestamp(p["window"][0]), pd.Timestamp(p["window"][1])
    span_days = (end - start).total_seconds() / 86400.0
    n = int(n_cases)

    # ---- documents and case attributes -----------------------------------------------
    extra = rng.poisson(float(p["items_per_document"]), size=n)
    sizes = 1 + extra
    doc_of = np.repeat(np.arange(n), sizes)[:n]
    n_docs = int(doc_of.max()) + 1
    doc_company = _choice(rng, p["companies"], n_docs)
    vendor_weights = 1.0 / np.arange(1, int(p["n_vendors"]) + 1) ** 0.8
    doc_vendor = rng.choice(
        np.array([f"V{i:03d}" for i in range(1, int(p["n_vendors"]) + 1)], dtype=object),
        size=n_docs,
        p=vendor_weights / vendor_weights.sum(),
    )
    doc_t0 = rng.uniform(0.0, max(span_days - 150.0, 1.0), size=n_docs)
    doc_t0 += rng.uniform(8 / 24, 18 / 24, size=n_docs)  # time of day
    cases = pd.DataFrame(
        {
            "case": [f"{d:06d}_{i:02d}" for d, i in zip(doc_of, np.concatenate([np.arange(s) for s in sizes])[:n])],
            "document": np.array([f"D{d:06d}" for d in doc_of], dtype=object),
            "company": doc_company[doc_of],
            "vendor": doc_vendor[doc_of],
            "flow_type": _choice(rng, p["flow_types"], n),
            "spend_area": _choice(rng, p["spend_areas"], n),
        }
    )
    net_worth = rng.lognormal(np.log(float(p["net_worth_median"])), float(p["net_worth_sigma"]), size=n)
    t0 = doc_t0[doc_of]

    # ---- baseline mechanisms ---------------------------------------------------------
    gr_lag = rng.lognormal(np.log(float(p["gr_lag_median_days"])), float(p["gr_lag_sigma"]), size=n)
    inv_lag = rng.lognormal(np.log(float(p["inv_lag_median_days"])), float(p["inv_lag_sigma"]), size=n)
    clr_lag = rng.lognormal(np.log(float(p["clr_lag_median_days"])), float(p["clr_lag_sigma"]), size=n)
    probs = np.array(p["gr_count_probs"], dtype=float)
    n_gr = rng.choice(np.arange(1, len(probs) + 1), size=n, p=probs / probs.sum())
    u_missing = rng.uniform(size=n)
    u_mismatch = rng.uniform(size=n)
    u_cancel = rng.uniform(size=n)
    missing_rate = np.full(n, float(p["missing_invoice_rate"]))
    mismatch_rate = np.full(n, float(p["mismatch_rate"]))
    cancel_rate = np.full(n, float(p["cancellation_rate"]))

    # ---- hotspots --------------------------------------------------------------------
    planted: list[Hotspot] = []
    for h in hs:
        where = dict(h["where"])
        mech = str(h["mechanism"])
        if mech not in MECHANISMS:
            raise ValueError(f"unknown mechanism {mech!r}; known: {sorted(MECHANISMS)}")
        strength = float(h["strength"])
        m = _mask(cases, where)
        if mech == "lag":
            inv_lag[m] *= strength
        elif mech == "missing_invoice":
            missing_rate[m] = strength
        elif mech == "fragmentation":
            n_gr[m] += round(strength)
        elif mech == "mismatch":
            mismatch_rate[m] = strength
        elif mech == "cancellation":
            cancel_rate[m] = strength
        planted.append(
            Hotspot(
                where=where,
                mechanism=mech,
                strength=strength,
                constraints=MECHANISMS[mech],
                n_cases=int(m.sum()),
                case_ids=tuple(cases["case"][m]),
            )
        )
    missing = u_missing < missing_rate
    big_mismatch = u_mismatch < mismatch_rate
    cancel = (u_cancel < cancel_rate) & ~missing

    # ---- amounts ---------------------------------------------------------------------
    gr_total = net_worth * rng.uniform(0.8, 1.0, size=n)
    po_amount = np.where(
        rng.uniform(size=n) < float(p["po_mismatch_rate"]),
        gr_total * (1 + rng.uniform(0.02, 0.10, size=n) * rng.choice([-1, 1], size=n)),
        gr_total,
    )
    eps = np.where(big_mismatch, rng.uniform(0.10, 0.50, size=n) * rng.choice([-1, 1], size=n), rng.normal(0.0, 0.01, size=n))
    inv_amount = np.maximum(gr_total * (1 + eps), 0.0)

    # ---- artefact: censoring (shift starts towards the window end) -------------------
    art_truth: dict[str, dict[str, Any]] = {}
    if art.get("censoring"):
        share = float(art["censoring"])
        m = rng.uniform(size=n) < share
        t0 = t0.copy()
        t0[m] = rng.uniform(span_days - 45.0, span_days - 0.5, size=int(m.sum()))
        art_truth["censoring"] = {"share": share, "case_ids": tuple(cases["case"][m])}

    # ---- events ----------------------------------------------------------------------
    rows: list[pd.DataFrame] = []
    users = np.array([f"user_{i:02d}" for i in range(1, 21)], dtype=object)

    def resource(k: int) -> np.ndarray:
        r = rng.choice(users, size=k)
        return np.where(rng.uniform(size=k) < float(p["batch_share"]), "batch_01", r)

    rows.append(pd.DataFrame({"case": cases["case"], "activity": PO, "day": t0, "amount": po_amount}))
    total_gr = int(n_gr.sum())
    case_rep = np.repeat(np.arange(n), n_gr)
    j = np.concatenate([np.arange(k) for k in n_gr])
    gr_day = t0[case_rep] + gr_lag[case_rep] + j * rng.uniform(0.5, 3.0, size=total_gr)
    split = rng.uniform(0.5, 1.5, size=total_gr)
    split_sum = np.bincount(case_rep, weights=split, minlength=n)
    gr_amount = gr_total[case_rep] * split / split_sum[case_rep]
    rows.append(pd.DataFrame({"case": cases["case"].to_numpy()[case_rep], "activity": GR, "day": gr_day, "amount": gr_amount}))
    first_gr = t0 + gr_lag
    has_inv = ~missing
    inv_day = first_gr + inv_lag
    rows.append(
        pd.DataFrame({"case": cases["case"][has_inv], "activity": INV, "day": inv_day[has_inv], "amount": inv_amount[has_inv]})
    )
    cinv_day = inv_day + rng.uniform(0.5, 5.0, size=n)
    rows.append(pd.DataFrame({"case": cases["case"][cancel], "activity": CINV, "day": cinv_day[cancel], "amount": np.nan}))
    clear = has_inv & ~cancel
    clr_day = inv_day + clr_lag
    rows.append(pd.DataFrame({"case": cases["case"][clear], "activity": CLR, "day": clr_day[clear], "amount": np.nan}))
    ev = pd.concat(rows, ignore_index=True)
    ev["resource"] = resource(len(ev))
    ev["time"] = _timestamps(start, ev["day"].to_numpy())
    ev = ev.drop(columns="day")
    natural_end = min(pd.Timestamp(ev["time"].max()), end)

    # ---- artefact: right-truncated window --------------------------------------------
    if "censoring" in art_truth:
        beyond = ev["time"].to_numpy() > np.datetime64(end.to_datetime64(), "ns")
        dropped_cases = set(ev.loc[beyond, "case"])
        art_truth["censoring"].update({"n_events_dropped": int(beyond.sum()), "case_ids_truncated": tuple(sorted(dropped_cases))})
        ev = ev[~beyond].reset_index(drop=True)

    # ---- artefact: replicated events -------------------------------------------------
    if art.get("replication"):
        share = float(art["replication"])
        m_cases = rng.uniform(size=n) < share
        rep_ids = set(cases["case"][m_cases])
        m = ev["case"].isin(rep_ids).to_numpy()
        extra_rows = pd.concat([ev[m], ev[m]], ignore_index=True)
        # copies keep activity and timestamp (a header posting replicated per item line)
        # but carry their own line amount and user, so they are not exact duplicates
        extra_rows["amount"] = extra_rows["amount"] * rng.uniform(0.9, 1.1, size=len(extra_rows))
        extra_rows["resource"] = resource(len(extra_rows))
        ev = pd.concat([ev, extra_rows], ignore_index=True)
        art_truth["replication"] = {
            "share": share,
            "factor": 3,
            "case_ids": tuple(sorted(rep_ids)),
            "n_events_added": len(extra_rows),
        }

    # ---- artefact: sentinel dates ----------------------------------------------------
    if art.get("sentinel_dates"):
        share = float(art["sentinel_dates"])
        m = rng.uniform(size=len(ev)) < share
        sentinels = np.array([np.datetime64("1900-01-01T00:00:00", "ns"), np.datetime64("2099-12-31T00:00:00", "ns")])
        pick = sentinels[rng.integers(0, 2, size=int(m.sum()))]
        times = ev["time"].to_numpy().copy()
        times[m] = pick
        ev["time"] = times
        art_truth["sentinel_dates"] = {
            "share": share,
            "n_events": int(m.sum()),
            "values": tuple(str(s) for s in sentinels),
            "case_ids": tuple(sorted(set(ev.loc[m, "case"]))),
        }

    # ---- artefact: exact duplicate events --------------------------------------------
    if art.get("duplicates"):
        share = float(art["duplicates"])
        m = rng.uniform(size=len(ev)) < share
        ev = pd.concat([ev, ev[m]], ignore_index=True)
        art_truth["duplicates"] = {"share": share, "n_events": int(m.sum())}

    # ---- artefact: timestamp precision mix -------------------------------------------
    if art.get("precision_mix"):
        share = float(art["precision_mix"])
        is_inv = (ev["activity"] == INV).to_numpy()
        m = is_inv & (rng.uniform(size=len(ev)) < share)
        times = ev["time"].to_numpy().copy()
        times[m] = times[m].astype("datetime64[D]").astype("datetime64[ns]")
        ev["time"] = times
        art_truth["precision_mix"] = {"share": share, "activity": INV, "n_events": int(m.sum())}

    # ---- artefact: vocabulary drift ---------------------------------------------------
    if art.get("vocabulary_drift"):
        spec = art["vocabulary_drift"] if isinstance(art["vocabulary_drift"], Mapping) else {}
        from_ts = pd.Timestamp(spec.get("from", natural_end - pd.Timedelta(days=92)))
        activity = str(spec.get("activity", INV))
        new_label = str(spec.get("new_label", f"{activity} (new)"))
        m = ((ev["activity"] == activity) & (ev["time"] >= from_ts)).to_numpy()
        ev.loc[m, "activity"] = new_label
        art_truth["vocabulary_drift"] = {
            "from": str(from_ts),
            "activity": activity,
            "new_label": new_label,
            "n_events": int(m.sum()),
        }

    # ---- attributes and exposure ------------------------------------------------------
    attrs = cases.set_index("case")
    ev = ev.merge(attrs, left_on="case", right_index=True, how="left")
    nw = pd.Series(net_worth, index=cases["case"])
    if art.get("unit_mixing"):
        company = str(art["unit_mixing"])
        m_c = (cases["company"] == company).to_numpy()
        nw = nw.copy()
        nw[m_c] *= 1000.0
        art_truth["unit_mixing"] = {"company": company, "factor": 1000.0, "n_cases": int(m_c.sum())}
    ev["net_worth"] = nw.reindex(ev["case"]).to_numpy()
    ev = ev.sample(frac=1.0, random_state=int(rng.integers(0, 2**31 - 1))).reset_index(drop=True)
    ev = ev[["case", "activity", "time", "amount", "resource", *CASE_ATTRIBUTES, "net_worth"]]

    norm = wise.running_p2p_norm()
    if scoring_mode is not None:
        norm = norm.replace(scoring_mode=scoring_mode)
    log = wise.EventLog(
        ev,
        case_col="case",
        activity_col="activity",
        timestamp_col="time",
        case_attributes=list(CASE_ATTRIBUTES),
        exposure_col="net_worth",
        exposure_agg="max",
        window=(start, end) if explicit_window else None,
    )
    truth = GroundTruth(
        template=template,
        n_cases=n,
        seed=int(seed),
        params={k: (list(v) if isinstance(v, tuple) else v) for k, v in p.items()},
        hotspots=tuple(planted),
        artefacts=art_truth,
        norm=norm,
        window=(start, end),
    )
    return log, truth


def subsample_cases(log: wise.EventLog, case_ids: Sequence[Any]) -> wise.EventLog:
    """A new :class:`wise.EventLog` restricted to ``case_ids`` (same mapping,
    attributes, exposure and window) — for finite-population experiments."""
    ev = log.events[log.events[log.case_col].isin(list(case_ids))]
    return wise.EventLog(
        ev,
        case_col=log.case_col,
        activity_col=log.activity_col,
        timestamp_col=log.timestamp_col,
        case_attributes=list(log.case_attributes),
        exposure_col=log.exposure_col,
        exposure_agg="max",
        event_id_col=log.event_id_col,
        window=log.window,
    )


__all__ = [
    "CASE_ATTRIBUTES",
    "DEFAULT_ARTEFACTS",
    "DEFAULT_HOTSPOTS",
    "DEFAULT_PARAMS",
    "MECHANISMS",
    "GroundTruth",
    "Hotspot",
    "generate",
    "subsample_cases",
]
