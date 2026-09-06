"""Command line: ``wise-knowledge validate | match | show | graph | explain``."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from . import __version__
from .graph import build_graph
from .labels import guess_label_column, read_labels, sniff_columns
from .loaders import load_mapping, load_pack
from .matching import KEY_COMPONENTS, Matcher, MatchKey, ObservedActivity
from .paths import available_packs, knowledge_root
from .schema import validate_datasets, validate_pack


def _table(rows: list[dict[str, Any]], columns: list[str] | None = None, max_width: int = 60) -> str:
    if not rows:
        return "(no rows)"
    columns = columns or list(rows[0].keys())
    cells = [[_cell(r.get(c, ""), max_width) for c in columns] for r in rows]
    widths = [max(len(c), *(len(row[i]) for row in cells)) for i, c in enumerate(columns)]
    line = "  ".join(c.ljust(widths[i]) for i, c in enumerate(columns))
    sep = "  ".join("-" * w for w in widths)
    body = "\n".join("  ".join(row[i].ljust(widths[i]) for i in range(len(columns))) for row in cells)
    return f"{line}\n{sep}\n{body}"


def _share(s: dict[str, Any]) -> str:
    v = float(s["value"])
    unit = s.get("unit")
    if unit:
        return f"{v:g} {unit}"
    return f"{v:.4f}" if v < 1 else f"{v:g}"


def _cell(value: Any, max_width: int) -> str:
    if isinstance(value, float):
        s = f"{value:.2f}"
    elif isinstance(value, list | tuple):
        s = ", ".join(str(v) for v in value)
    else:
        s = str(value)
    s = s.replace("\n", " ")
    return s if len(s) <= max_width else s[: max_width - 1] + "…"


# --------------------------------------------------------------------------- validate
def cmd_validate(args: argparse.Namespace) -> int:
    root = knowledge_root()
    targets = [args.pack] if args.pack else sorted(available_packs())
    report: dict[str, Any] = {"root": str(root), "datasets": [], "packs": {}}
    errors = 0
    ds_issues = validate_datasets()
    report["datasets"] = [str(i) for i in ds_issues]
    errors += sum(1 for i in ds_issues if i.level == "error")
    for name in targets:
        issues = validate_pack(name)
        report["packs"][name] = [str(i) for i in issues]
        errors += sum(1 for i in issues if i.level == "error")
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"knowledge root: {root}")
        print(f"datasets.yaml: {'OK' if not ds_issues else ''}")
        for i in ds_issues:
            print(f"  {i}")
        for name in targets:
            issues = report["packs"][name]
            print(f"pack {name}: {'OK' if not issues else f'{len(issues)} issue(s)'}")
            for i in issues:
                print(f"  {i}")
        print(f"{'VALID' if errors == 0 else 'INVALID'}: {len(targets)} pack(s), {errors} error(s)")
    return 0 if errors == 0 else 1


# --------------------------------------------------------------------------- match
def _parse_key(args: argparse.Namespace, columns: list[str] | None) -> MatchKey:
    label = args.column
    if label is None and columns is not None:
        label = guess_label_column(columns)
        if label is None:
            raise SystemExit(f"cannot guess the label column; give --column. Columns: {columns}")
    parts: dict[str, str] = {}
    for spec in args.key or []:
        if "=" not in spec:
            raise SystemExit(f"--key expects component=column, got {spec!r}")
        comp, col = spec.split("=", 1)
        comp = comp.strip().replace("-", "_")
        if comp not in KEY_COMPONENTS:
            raise SystemExit(f"--key component must be one of {KEY_COMPONENTS}, got {comp!r}")
        parts[comp] = col.strip()
    return MatchKey(label=label or "activity", **parts)


def cmd_match(args: argparse.Namespace) -> int:
    pack = load_pack(args.pack)
    if args.labels_from:
        columns = sniff_columns(args.labels_from, encoding=args.encoding, sep=args.sep)
        key = _parse_key(args, columns)
        missing = [c for c in key.columns() if c not in columns]
        if missing:
            raise SystemExit(f"columns {missing} not in {args.labels_from}; available: {columns}")
        observed = read_labels(args.labels_from, key, encoding=args.encoding, sep=args.sep)
    elif args.labels:
        key = _parse_key(args, None)
        observed = [ObservedActivity(label=lbl) for lbl in args.labels]
    else:
        raise SystemExit("give --labels-from CSV or one or more --label values")
    label_packs: list[str] | None
    if args.no_label_packs:
        label_packs = []
    elif args.label_packs:
        label_packs = [p.strip() for p in args.label_packs.split(",") if p.strip()]
    else:
        label_packs = None
    matcher = Matcher(pack, label_packs=label_packs, key=key, top_k=args.top, min_confidence=args.min_confidence)
    results = matcher.match_many(observed)
    rows = []
    for r in results:
        best = r.best
        alt = r.candidates[1] if len(r.candidates) > 1 else None
        rows.append(
            {
                "label": r.observed.key_text,
                "events": r.observed.count,
                "canonical_id": best.activity_id if best else "",
                "stage": best.stage if best else "",
                "confidence": best.confidence if best else 0.0,
                "tier": r.status,
                "method": best.method if best else "",
                "alternative": f"{alt.activity_id} ({alt.confidence:.2f})" if alt else "",
            }
        )
    oracle = None
    if args.oracle:
        oracle = load_mapping(args.oracle)
    elif args.oracle_id:
        oracle = pack.mappings[args.oracle_id]
    evaluation = matcher.evaluate(oracle, observed) if oracle else None
    if args.format == "json":
        payload: dict[str, Any] = {
            "pack": pack.id,
            "key": key.__dict__,
            "label_packs": matcher.label_packs,
            "rows": rows,
        }
        if evaluation:
            payload["evaluation"] = {
                "n": evaluation.n,
                "top1": evaluation.top1,
                "top3": evaluation.top3,
                "top1_rate": evaluation.top1_rate,
                "misses": evaluation.misses,
            }
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0
    if args.format == "csv":
        import csv as _csv

        writer = _csv.DictWriter(sys.stdout, fieldnames=list(rows[0].keys()) if rows else ["label"])
        writer.writeheader()
        writer.writerows(rows)
    else:
        print(_table(rows))
    tiers = {t: sum(1 for r in rows if r["tier"] == t) for t in ("high", "medium", "low", "unmatched")}
    print()
    print(
        f"pack {pack.id}; key {key.columns()}; label packs {matcher.label_packs or 'none'}; {len(rows)} distinct keys"
    )
    print(f"tiers: high {tiers['high']}, medium {tiers['medium']}, low {tiers['low']}, unmatched {tiers['unmatched']}")
    if evaluation:
        print(
            f"oracle {oracle.id}: top-1 {evaluation.top1}/{evaluation.n} = {evaluation.top1_rate:.1%}, top-3 {evaluation.top3}/{evaluation.n} = {evaluation.top3_rate:.1%}"
        )
        for m in evaluation.misses:
            print(f"  miss: {m['label']!r} expected {m['expected']} got {m['got']} ({m['confidence']:.2f})")
    return 0


# --------------------------------------------------------------------------- show
def cmd_show(args: argparse.Namespace) -> int:
    pack = load_pack(args.pack)
    lang = args.lang
    if args.what == "stages":
        rows = []
        for s in pack.stages:
            acts = pack.activities_in_stage(s.id)
            rows.append(
                {
                    "order": s.order,
                    "id": s.id,
                    "name": s.name.get(lang, s.name["en"]),
                    "activities": len(acts),
                    "milestones": list(s.milestones),
                    "loops_to": list(s.loops_allowed_to),
                }
            )
        print(_table(rows))
        if pack.stage_model.variants:
            print()
            print(
                _table(
                    [
                        {
                            "variant": v.id,
                            "name": v.name.get(lang, v.name["en"]),
                            "stages": " → ".join(v.stage_sequence),
                            "codes": v.flow_type_codes,
                            "evidence": v.evidence,
                        }
                        for v in pack.stage_model.variants
                    ]
                )
            )
    elif args.what == "failure-modes":
        rows = []
        for fm in pack.failure_modes:
            refs = [p.constraint_ref for p in fm.wise_patterns if p.constraint_ref]
            share = ""
            if fm.observed_share:
                s0 = fm.observed_share[0]
                share = f"{_share(s0)} of {s0['of']} ({s0['source']})"
            rows.append(
                {
                    "id": fm.id,
                    "name": fm.name.get(lang, fm.name["en"]),
                    "stage": fm.stage,
                    "patterns": [p.type for p in fm.wise_patterns],
                    "constraints": refs,
                    "evidence": fm.evidence,
                    "observed": share,
                    "owner": fm.owner_role,
                }
            )
        print(_table(rows, max_width=48))
    elif args.what == "glossary":
        rows = [
            {
                "term_en": t.term["en"],
                "term_de": t.term.get("de", ""),
                "definition": t.definition.get(lang, t.definition["en"]),
            }
            for t in pack.glossary
        ]
        print(_table(rows, max_width=90))
    elif args.what == "activities":
        rows = [
            {
                "id": a.id,
                "stage": a.stage,
                "name": a.name.get(lang, a.name["en"]),
                "granularity": a.granularity or "",
                "tags": list(a.tags),
            }
            for a in pack.activities
        ]
        print(_table(rows))
    elif args.what == "kpis":
        rows = [
            {
                "id": k.id,
                "name": k.name.get(lang, k.name["en"]),
                "unit": k.unit,
                "direction": k.direction,
                "formula": k.formula,
            }
            for k in pack.kpis
        ]
        print(_table(rows, max_width=70))
    elif args.what == "label-packs":
        rows = [
            {"label_pack": n, "system": lp.system, "labels": len(lp.labels), "dataset": lp.dataset or ""}
            for n, lp in pack.label_packs.items()
        ]
        print(_table(rows))
    return 0


# --------------------------------------------------------------------------- graph / explain
def cmd_graph(args: argparse.Namespace) -> int:
    pack = load_pack(args.pack)
    g = build_graph(pack)
    by_type = {t: len(g.nodes_of_type(t)) for t in sorted({n.type for n in g.nodes})}
    by_edge = {t: len(g.edges_of_type(t)) for t in sorted({e.type for e in g.edges})}
    print(f"pack {pack.id}: {len(g.nodes)} nodes, {len(g.edges)} edges")
    print("nodes: " + ", ".join(f"{k} {v}" for k, v in by_type.items()))
    print("edges: " + ", ".join(f"{k} {v}" for k, v in by_edge.items()))
    if args.out:
        n, e = g.write_csv(args.out)
        print(f"written {n} and {e}")
    return 0


def cmd_explain(args: argparse.Namespace) -> int:
    pack = load_pack(args.pack)
    g = build_graph(pack)
    paths = g.explain(args.constraint, template=args.template)
    if not paths:
        print(f"no failure mode is linked to constraint {args.constraint!r}")
        return 1
    for p in paths:
        print(
            f"constraint {p['constraint']} ({p['template']}) detects: {p['failure_mode_name']} [{p['failure_mode']}], stage {p['stage']}"
        )
        print("  candidate causes to test: " + "; ".join(p["causes"]))
        print("  candidate remedies: " + "; ".join(p["remedies"]))
        print("  evidence to check first: " + "; ".join(p["evidence_to_check"]))
        print("  owner role: " + ", ".join(p["owner_role"]))
        print("  sources: " + "; ".join(p["sources"]))
    return 0


# --------------------------------------------------------------------------- parser
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="wise-knowledge", description="Process knowledge packs for WISE Workbench.")
    parser.add_argument("--version", action="version", version=f"wise-knowledge {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("validate", help="validate datasets.yaml and the packs against the schemas")
    p.add_argument("pack", nargs="?", help="pack name or directory; all packs when omitted")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_validate)

    p = sub.add_parser("match", help="match log labels to canonical activities")
    p.add_argument("pack")
    p.add_argument("--labels-from", type=Path, help="CSV event log")
    p.add_argument("--column", help="label column (guessed from common names when omitted)")
    p.add_argument(
        "--key",
        action="append",
        metavar="COMPONENT=COLUMN",
        help="extra key component: lifecycle, document_type or subprocess",
    )
    p.add_argument("--label", dest="labels", action="append", help="ad-hoc label instead of a CSV (repeatable)")
    p.add_argument("--label-packs", help="comma-separated label packs to use (default: all)")
    p.add_argument("--no-label-packs", action="store_true", help="lexical matching only (names and synonyms)")
    p.add_argument("--top", type=int, default=5)
    p.add_argument("--min-confidence", type=float, default=0.3)
    p.add_argument("--oracle", type=Path, help="curated mapping file to score against")
    p.add_argument("--oracle-id", help="id of a mapping shipped with the pack (mappings/<id>.yaml)")
    p.add_argument("--encoding")
    p.add_argument("--sep")
    p.add_argument("--format", choices=["table", "csv", "json"], default="table")
    p.set_defaults(func=cmd_match)

    p = sub.add_parser("show", help="print parts of a pack")
    p.add_argument("pack")
    p.add_argument("what", choices=["stages", "failure-modes", "glossary", "activities", "kpis", "label-packs"])
    p.add_argument("--lang", choices=["en", "de"], default="en")
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("graph", help="build the knowledge graph and report node and edge counts")
    p.add_argument("pack")
    p.add_argument("--out", type=Path, help="directory for <pack>_nodes.csv and <pack>_edges.csv")
    p.set_defaults(func=cmd_graph)

    p = sub.add_parser("explain", help="explanation path for a template constraint")
    p.add_argument("pack")
    p.add_argument("constraint")
    p.add_argument("--template")
    p.set_defaults(func=cmd_explain)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
