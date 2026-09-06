"""Checkpoint CP-C2: run the analytics on the running example and on a synthetic log.

Usage::

    python -m wise_analytics.demo [--n-cases 3000] [--seed 1] [--B 200] [--quiet]

Prints, for the paper's running example and for a synthetic P2P log with
planted hotspots and artefacts: bootstrap intervals with stability badges,
a contrast waterfall that sums to the gap, headroom under the norm, the
readiness report with its window end, the plain card sentences (real-unit
comparison, points below the overall score, kind of problem), the caveats
that touch a group, and the sub-groups inside it. Exit code 0 when every
identity holds, every planted artefact is flagged and every sentence passes
the vocabulary check; 1 otherwise.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Sequence

import pandas as pd
import wise

from . import synthetic
from ._version import __version__
from .contrast import contrast_slice
from .plain import comparison_sentence, kind_reading, points_below, problem_kind
from .quality import caveats_for_slice, readiness
from .subgroups import subgroups
from .uncertainty import bootstrap_backlog, sensitivity_envelope
from .vocabulary import forbidden_terms
from .whatif import headroom

ARTEFACT_CHECKS = {
    "censoring": ("right_censoring", "window_edge_share"),
    "replication": ("replication",),
    "sentinel_dates": ("sentinel_dates",),
    "duplicates": ("duplicate_events",),
    "precision_mix": ("timestamp_precision",),
    "vocabulary_drift": ("vocabulary_drift",),
    "unit_mixing": ("exposure_sanity",),
    "logging_asymmetry": ("logging_asymmetry",),
    "frequency_drift": ("frequency_drift",),
}


def _title(text: str) -> None:
    print()
    print(text)
    print("-" * len(text))


def _show(df: pd.DataFrame, cols: Sequence[str] | None = None, n: int | None = None, digits: int = 4) -> None:
    d = df if cols is None else df[[c for c in cols if c in df.columns]]
    if n is not None:
        d = d.head(n)
    print(d.round(digits).to_string())


def run_running_example(B: int, seed: int, quiet: bool) -> list[str]:
    failures: list[str] = []
    log, norm = wise.running_p2p_log(), wise.running_p2p_norm()
    result = wise.score(log, norm)
    _title("1. Running example (paper Tables V–VI): bootstrap intervals and badges, Finance view, by company, γ = 2")
    u = bootstrap_backlog(result, by="company", view="Finance", gamma=2.0, B=B, seed=seed, min_support=2)
    _show(
        u.table,
        [
            "n_cases",
            "mean_score",
            "stable_gap",
            "stable_gap_lo",
            "stable_gap_hi",
            "stable_PI",
            "stable_PI_lo",
            "stable_PI_hi",
            "rank",
            "rank_lo",
            "rank_hi",
            "p_top5",
            "stability",
        ],
    )
    print(f"record: {u.record.cite()}  runtime {u.summary['runtime_s']:.3f} s")
    if not quiet:
        for r in u.readings:
            print("  " + r)

    _title("2. Running example: contrast waterfall for company=B under Finance (bars sum to the gap)")
    c = contrast_slice(result, "Finance", {"company": "B"}, B=B, seed=seed)
    _show(
        c.table,
        [
            "layer",
            "delta",
            "delta_lo",
            "delta_hi",
            "share_of_gap",
            "rate_slice",
            "rate_rest",
            "risk_difference",
            "unit",
            "median_slice",
            "median_rest",
            "hl_shift",
            "pattern",
        ],
    )
    total, gap, err = c.table["delta"].sum(), c.summary["signed_gap"], c.summary["decomposition_error"]
    print(f"sum of bars = {total:.12f}   gap = μ̄ − μ_s = {gap:.12f}   |difference| = {err:.1e}  (must be ≤ 1e-9)")
    if err > 1e-9:
        failures.append("running example: waterfall does not sum to the gap")
    _show(c.layers, ["delta", "share_of_gap"])
    if not quiet:
        for r in c.readings:
            print("  " + r)

    _title("3. Running example: headroom under the norm for company=B (Finance, γ = 2)")
    h = headroom(result, "Finance", {"company": "B"}, gamma=2.0)
    _show(h.table, ["layer", "headroom_score", "headroom_PI", "stable_PI_after", "PI_reduction", "share_of_PI", "share_violated"])
    print(
        f"Σ headroom_score = {h.summary['sum_headroom_score']:.12f}  1 − μ_s = {h.summary['one_minus_mean']:.12f}  identity error {h.summary['identity_error']:.1e}"
    )
    if h.summary["identity_error"] > 1e-9:
        failures.append("running example: headroom identity violated")
    if not quiet:
        for r in h.readings[:2]:
            print("  " + r)

    _title("4. Running example: readiness (closure = Clear Invoice / Cancel Invoice Receipt, opened by an invoice)")
    q = readiness(
        log,
        norm,
        result=result,
        by="company",
        view="Finance",
        gamma=2.0,
        closure=["Clear Invoice", "Cancel Invoice Receipt"],
        opened_by="Record Invoice Receipt",
    )
    _show(q.table, ["status", "value", "threshold_warn", "threshold_fail"])
    print(f"overall: {q.status}   window end {q.summary['window_end']} ({q.summary['window_end_source']})")

    _title("11. Running example: plain card sentences for company=B (Finance, γ = 2)")
    backlog = wise.prioritize(result, "company", view="Finance", gamma=2.0)
    kinds = problem_kind(backlog)
    row = backlog.loc["B"]
    sentence = comparison_sentence(c, items="purchase order items", labels={"c3": "invoiced vs received amount"})
    print(f"  comparison : {sentence}")
    print(f"  distance   : {points_below(row['mean_score'], row['global_mean'])}")
    print(
        f"  kind       : {kind_reading(kinds.loc['B', 'kind'], items='purchase order items')} (library alias: {kinds.loc['B', 'hotspot']})"
    )
    for text in (sentence, kind_reading(kinds.loc["B", "kind"])):
        if forbidden_terms(text):
            failures.append(f"running example: plain sentence uses forbidden vocabulary: {text!r}")
    caveats = caveats_for_slice(q, {"company": "B"}, items="purchase order items", closure_label="clearing")
    print("  caveats    : " + ("; ".join(cv.text for cv in caveats) if caveats else "none touch this group"))
    return failures


def run_synthetic(n_cases: int, B: int, seed: int, quiet: bool) -> list[str]:
    failures: list[str] = []
    t0 = time.perf_counter()
    log, truth = synthetic.generate(n_cases=n_cases, seed=seed, artefacts=synthetic.DEFAULT_ARTEFACTS)
    result = wise.score(log, truth.norm)
    _title(
        f"5. Synthetic P2P log: {len(log.events):,} events, {len(log):,} cases (generated and scored in {time.perf_counter() - t0:.2f} s)"
    )
    print("planted hotspots:")
    for hs in truth.hotspots:
        print(f"  {hs.label():40s} mechanism={hs.mechanism:16s} strength={hs.strength:g}  loads {hs.constraints}  n={hs.n_cases}")
    print(
        "planted artefacts: "
        + ", ".join(
            f"{k}={v['share'] if 'share' in v else v.get('company', v.get('new_label', v.get('activity', '')))}"
            for k, v in truth.artefacts.items()
        )
    )

    by = ["company", "spend_area"]
    _title("6. Synthetic: bootstrap by company × spend_area, Finance, γ = 20 (cluster bootstrap by purchasing document)")
    u = bootstrap_backlog(result, by=by, view="Finance", gamma=20.0, B=B, seed=seed, cluster="document")
    _show(
        u.table,
        [
            "n_cases",
            "stable_gap",
            "stable_gap_lo",
            "stable_gap_hi",
            "stable_PI",
            "stable_PI_lo",
            "stable_PI_hi",
            "rank",
            "rank_lo",
            "rank_hi",
            "p_top5",
            "p_top10",
            "stability",
        ],
        n=8,
    )
    print(f"badges: {dict(u.summary['badges'])}   record: {u.record.cite()}   runtime {u.summary['runtime_s']:.2f} s")
    top = u.table.index[0]
    planted = truth.hotspots[0]
    if tuple(top) != tuple(planted.where[k] for k in by):
        failures.append(f"synthetic: top slice {top} is not the planted lag hotspot {planted.label()}")

    _title("7. Synthetic: sensitivity envelope (γ grid, thresholds ×0.8/×1.25, weight jitter ±10 %)")
    e = sensitivity_envelope(result, by=by, view="Finance", gamma=20.0, k=5, seed=seed)
    _show(
        e.table, ["n_cases", "stable_PI", "rank_ref", "rank_min", "rank_max", "topk_settings", "n_settings", "always_topk"], n=6
    )
    print(f"settings: {e.summary['n_settings']}, min top-5 Jaccard vs reference {e.summary['min_top_k_overlap']:.2f}")

    _title(f"8. Synthetic: contrast waterfall for the planted hotspot {planted.label()} (Finance)")
    c = contrast_slice(result, "Finance", dict(planted.where), B=B, seed=seed)
    _show(
        c.table,
        [
            "layer",
            "delta",
            "delta_lo",
            "delta_hi",
            "share_of_gap",
            "rate_slice",
            "rate_rest",
            "risk_difference",
            "unit",
            "median_slice",
            "median_rest",
            "hl_shift",
            "cliffs_delta",
            "pattern",
        ],
    )
    print(
        f"sum of bars = {c.table['delta'].sum():.12f}   gap = {c.summary['signed_gap']:.12f}   |difference| = {c.summary['decomposition_error']:.1e}"
    )
    if c.summary["decomposition_error"] > 1e-9:
        failures.append("synthetic: waterfall does not sum to the gap")
    if c.summary["top_constraint"] != planted.constraint:
        failures.append(f"synthetic: top driver {c.summary['top_constraint']} is not the planted {planted.constraint}")
    if not quiet:
        for r in c.readings[:2]:
            print("  " + r)

    _title(f"9. Synthetic: headroom under the norm for {planted.label()} (Finance, γ = 20)")
    h = headroom(result, "Finance", dict(planted.where), gamma=20.0)
    _show(h.table, ["layer", "headroom_score", "headroom_PI", "stable_PI_after", "PI_reduction", "share_of_PI", "share_violated"])
    print(f"identity error {h.summary['identity_error']:.1e}")
    if h.summary["identity_error"] > 1e-9:
        failures.append("synthetic: headroom identity violated")

    _title("10. Synthetic: readiness report (planted artefacts must be flagged)")
    q = readiness(
        log,
        truth.norm,
        result=result,
        by=by,
        view="Finance",
        gamma=20.0,
        closure="Clear Invoice",
        group_col="company",
        document_col="document",
    )
    _show(q.table, ["status", "value", "threshold_warn", "threshold_fail"])
    print(f"overall: {q.status}   window end {q.summary['window_end']} ({q.summary['window_end_source']})")
    print(f"record: {q.record.cite()}   runtime {q.summary['runtime_s']:.2f} s")
    if not quiet:
        for r in q.readings:
            print("  " + r)
    print("planted artefact → check status:")
    for art, checks in ARTEFACT_CHECKS.items():
        if art not in truth.artefacts:
            continue
        statuses = {ch: q.table.loc[ch, "status"] for ch in checks}
        flagged = any(s in ("warn", "fail") for s in statuses.values())
        print(f"  {art:18s} {'flagged' if flagged else 'MISSED ':8s} {statuses}")
        if not flagged:
            failures.append(f"synthetic: artefact {art} not flagged")

    _title(f"12. Synthetic: plain card sentences and caveats for {planted.label()} (Finance, γ = 20)")
    backlog = bootstrap_backlog(result, by=by, view="Finance", gamma=20.0, B=1, seed=seed).table
    kinds = problem_kind(backlog)
    key = tuple(planted.where[k] for k in by)
    sentence = comparison_sentence(c, items="purchase order items")
    print(f"  comparison : {sentence}")
    print(f"  distance   : {points_below(backlog.loc[key, 'mean_score'], backlog.loc[key, 'global_mean'])}")
    print(
        f"  kind       : {kind_reading(kinds.loc[key, 'kind'], items='purchase order items')} (library alias: {kinds.loc[key, 'hotspot']})"
    )
    if forbidden_terms(sentence) or not sentence:
        failures.append(f"synthetic: comparison sentence empty or not descriptive: {sentence!r}")
    if kinds.loc[key, "kind"] == "none":
        failures.append("synthetic: the planted hotspot has no kind")
    caveats = caveats_for_slice(q, dict(planted.where), items="purchase order items", closure_label="clearing")
    for cv in caveats:
        print(f"  caveat [{cv.status:4s}] {cv.text}")
        if not 0.0 <= cv.share <= 1.0 or forbidden_terms(cv.text):
            failures.append(f"synthetic: caveat {cv.id} out of range or not descriptive")
    if q.slices is not None and "censored_share" in q.slices.columns:
        most = q.slices["censored_share"].idxmax()
        print(f"  most censored top slice {most}: {q.slices.loc[most, 'reading']}")

    _title(f"13. Synthetic: sub-groups inside {planted.label()} by vendor, flow type and start quarter (Finance)")
    sg = subgroups(
        result,
        dict(planted.where),
        ["vendor", "flow_type"],
        view="Finance",
        period="Q",
        censored=q.case_flags["censored"] if q.case_flags is not None else None,
        window_end=q.window_end,
        top=5,
        items="purchase order items",
        closure_label="clearing",
    )
    _show(sg.table, ["n_cases", "penalty_mass", "mean_penalty", "share", "cum_share", "censored_share", "partial_period"])
    for attr, facts in sg.summary["per_attribute"].items():
        print(f"  {attr}: {facts['values_for_80pct']} of {facts['n_values']} values carry 80 % of the penalty mass")
    if not quiet:
        for r in sg.readings:
            print("  " + r)
    full = subgroups(result, dict(planted.where), ["vendor", "flow_type"], view="Finance")
    for attr in full.attributes:
        share_sum = float(full.table.loc[attr, "share"].sum())
        if abs(share_sum - 1.0) > 1e-9:
            failures.append(f"synthetic: sub-group shares by {attr} sum to {share_sum}, not 1")
    for text in sg.readings:
        if forbidden_terms(text):
            failures.append(f"synthetic: sub-group reading uses forbidden vocabulary: {text!r}")
    return failures


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m wise_analytics.demo", description=__doc__.split("\n\n")[0])
    parser.add_argument("--n-cases", type=int, default=3000)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--B", type=int, default=200, help="bootstrap replicates")
    parser.add_argument("--quiet", action="store_true", help="omit the template readings")
    args = parser.parse_args(argv)
    pd.set_option("display.width", 220)
    pd.set_option("display.max_columns", 40)
    pd.set_option("display.max_colwidth", 60)
    print(f"wise-analytics {__version__} on wise {wise.__version__}")
    t0 = time.perf_counter()
    failures = run_running_example(args.B, args.seed, args.quiet)
    failures += run_synthetic(args.n_cases, args.B, args.seed, args.quiet)
    print()
    print(f"total runtime {time.perf_counter() - t0:.2f} s")
    if failures:
        print("CHECKS FAILED:")
        for f in failures:
            print("  - " + f)
        return 1
    print(
        "all checks passed: waterfalls sum to the gap, headroom identities hold, planted artefacts flagged, sentences descriptive"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
