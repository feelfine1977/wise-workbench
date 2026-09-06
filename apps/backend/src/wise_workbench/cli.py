"""Command line: serve, worker, migrate, openapi, health, demo ingest, demo run."""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Any

from wise_workbench import __version__
from wise_workbench.presets import BPIC19_MAPPING, PM4PY_MAPPING, suggest_mapping
from wise_workbench.settings import Settings, load_settings

DEMO_PROJECT = "Demo"

__all__ = ["BPIC19_MAPPING", "PM4PY_MAPPING", "build_parser", "main"]

# Column aliases for the demo: short names → likely column names (checked against the case table).
SLICING_ALIASES: dict[str, list[str]] = {
    "vendor": ["case Vendor", "vendor"],
    "company": ["case Company", "company"],
    "spend_area": ["case Spend area text", "spend_area"],
    "spend": ["case Spend area text"],
    "item_type": ["case Item Type"],
    "document": ["case Purchasing Document"],
    "purchasing_document": ["case Purchasing Document"],
    "document_type": ["case Document Type"],
    "flow_type": ["flow_type"],
}


def _settings(args: argparse.Namespace) -> Settings:
    overrides: dict[str, Any] = {}
    if getattr(args, "workspace", None):
        overrides["workspace"] = Path(args.workspace)
    if getattr(args, "log_format", None):
        overrides["log_format"] = args.log_format
    return load_settings(**overrides)


# ----------------------------------------------------------------------------- commands
def _display_host(host: str) -> str:
    return "127.0.0.1" if host in ("0.0.0.0", "::", "") else host


def open_browser_when_ready(url: str, health_url: str, timeout: float = 30.0) -> threading.Thread:
    """Open ``url`` in the default browser once ``health_url`` answers 200 (polled from a daemon thread)."""
    import httpx

    def _wait() -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                if httpx.get(health_url, timeout=1.0).status_code == 200:
                    webbrowser.open(url)
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.25)

    thread = threading.Thread(target=_wait, name="open-browser", daemon=True)
    thread.start()
    return thread


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from wise_workbench.api.app import create_app

    settings = _settings(args)
    if args.host:
        settings = settings.model_copy(update={"host": args.host})
    if args.port:
        settings = settings.model_copy(update={"port": args.port})
    if args.no_worker:
        settings = settings.model_copy(update={"inprocess_worker": False})
    if args.static:
        settings = settings.model_copy(update={"static_dir": Path(args.static)})
    app = create_app(settings)
    base = f"http://{_display_host(settings.host)}:{settings.port}"
    static_dir = settings.resolved_static_dir
    if static_dir is not None:
        print(
            f"WISE Workbench {__version__}: application at {base}/ (built frontend from {static_dir}), "
            f"API documentation at {base}/docs, workspace {settings.workspace_path}",
            file=sys.stderr,
        )
    else:
        print(
            f"WISE Workbench {__version__}: API documentation at {base}/docs, workspace {settings.workspace_path}. "
            "No built frontend found: build it (apps/frontend: npm run build:live) or set WISE_STATIC_DIR / --static.",
            file=sys.stderr,
        )
    if args.open:
        open_browser_when_ready(
            f"{base}/" if static_dir is not None else f"{base}/docs", f"{base}/api/v1/system/health"
        )
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info", access_log=False)
    return 0


def cmd_worker(args: argparse.Namespace) -> int:
    from wise_workbench.container import Container
    from wise_workbench.jobs.worker import Worker

    c = Container(_settings(args))
    worker = Worker(c, worker_id=args.worker_id)
    if args.once:
        n = worker.drain(max_jobs=args.max_jobs)
        print(f"ran {n} job(s)", file=sys.stderr)
        return 0
    worker.run_forever()
    return 0


def cmd_migrate(args: argparse.Namespace) -> int:
    from wise_workbench.adapters.db.migrate import current, upgrade

    settings = _settings(args)
    settings.workspace_path.mkdir(parents=True, exist_ok=True)
    url = settings.resolved_database_url
    upgrade(url)
    print(f"database {url} at revision {current(url)}")
    return 0


def cmd_openapi(args: argparse.Namespace) -> int:
    from wise_workbench.api.app import openapi_document

    doc = openapi_document()
    if args.yaml:
        import yaml

        text = yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, width=1000)
    else:
        text = json.dumps(doc, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        print(text)
    return 0


def cmd_health(args: argparse.Namespace) -> int:
    import httpx

    settings = _settings(args)
    url = args.url or f"http://{settings.host}:{settings.port}/api/v1/system/health"
    try:
        r = httpx.get(url, timeout=5)
    except httpx.HTTPError as exc:
        print(f"unreachable: {exc}")
        return 1
    print(f"{r.status_code} {r.text}")
    return 0 if r.status_code == 200 else 1


# ----------------------------------------------------------------------------- demo
def _demo_project(c: Any) -> Any:
    for p in c.projects.list():
        if p.name == DEMO_PROJECT:
            return p
    return c.projects.create(
        DEMO_PROJECT, process="p2p", question="Where does the purchase-to-pay flow fall short of expectations?"
    )


def _drain(c: Any, label: str) -> None:
    from wise_workbench.jobs.worker import Worker

    t0 = time.perf_counter()
    Worker(c, worker_id="cli").drain()
    print(f"  {label}: {time.perf_counter() - t0:.1f}s", file=sys.stderr)


def _detect_mapping(columns: list[str], args: argparse.Namespace) -> dict[str, Any]:
    if args.case and args.activity and args.timestamp:
        doc: dict[str, Any] = {
            "caseId": args.case,
            "activity": args.activity,
            "timestamp": args.timestamp,
            "caseAttributes": args.attr or [],
        }
        if args.timestamp_format:
            doc["timestampFormat"] = args.timestamp_format
        return doc
    suggestion = suggest_mapping(columns)
    guessed: dict[str, Any] = suggestion["mapping"]
    if suggestion["source"] == "heuristic" and not all(guessed.get(r) for r in ("caseId", "activity", "timestamp")):
        raise SystemExit("cannot guess the mapping; pass --case, --activity and --timestamp")
    return guessed


def _print_readiness(table: Any) -> None:
    print(
        f"\nCase table {table.id}: {table.cases:,} cases, {table.events:,} events, {len(table.activities)} activities"
    )
    if table.readiness is None:
        print("  (no readiness report)")
        return
    print(f"Readiness: {str(table.readiness.status).upper()}")
    for item in table.readiness.items:
        print(f"  [{str(item.level).upper():4}] {item.id}: {item.message}")
        if item.id == "timestamp_precision":
            rows = item.evidence.get("activities", [])[:8]
            for r in rows:
                print(f"          {r['activity'][:45]:45} {r['precision']:10} ({r['events']:,} events)")
        if item.id == "sentinel_dates":
            for v in item.evidence.get("values", [])[:5]:
                print(
                    f"          {v['timestamp']}: {v['events']:,} events{' (outside window)' if v.get('outsideWindow') else ''}"
                )
        if item.id == "timestamp_outliers":
            ev = item.evidence
            print(f"          earliest {ev.get('earliest')}, latest {ev.get('latest')}")
    print("Activities (top 10):")
    for a in sorted(table.activities, key=lambda a: -a.events)[:10]:
        print(f"  {a.label[:45]:45} {a.events:>10,} events {a.cases:>10,} cases")


def cmd_demo_ingest(args: argparse.Namespace) -> int:
    from wise_workbench.container import Container

    c = Container(_settings(args))
    project = _demo_project(c)
    csv = Path(args.csv).expanduser().resolve()
    t0 = time.perf_counter()
    print(f"Project {project.id} ({project.name}); ingesting {csv} (not copied)", file=sys.stderr)
    dataset, _job = c.datasets.ingest_path(project.id, csv)
    _drain(c, "ingest")
    dataset = c.datasets.get(project.id, dataset.id)
    if str(dataset.status) != "ready":
        print(f"ingest failed: {dataset.error}")
        return 1
    print(
        f"Dataset {dataset.id}: {dataset.events:,} events, {len(dataset.columns)} columns, sha256 {dataset.content_hash[:12] if dataset.content_hash else '-'}",
        file=sys.stderr,
    )
    doc = _detect_mapping([col.name for col in dataset.columns], args)
    _mapping, table, _job, sample = c.mappings.create(project.id, dataset.id, doc)
    print(
        f"Mapping validated on {sample['sampleEvents']:,} sample events; flow types {sample['flowTypes']}",
        file=sys.stderr,
    )
    _drain(c, "build_cases")
    table = c.mappings.get_case_table(project.id, table.id)
    if str(table.status) != "ready":
        print(f"case table build failed: {table.error}")
        return 1
    _print_readiness(table)
    print(f"\nTotal {time.perf_counter() - t0:.1f}s. Case table id: {table.id}")
    return 0


def _resolve_attribute(name: str, columns: list[str]) -> str:
    if name in columns:
        return name

    def norm(s: str) -> str:
        return "".join(ch for ch in s.lower().replace("case ", "") if ch.isalnum())

    for cand in SLICING_ALIASES.get(name.lower(), []):
        if cand in columns:
            return cand
    target = norm(name)
    for col in columns:
        if norm(col) == target:
            return col
    raise SystemExit(f"unknown slicing attribute {name!r}; case table attributes: {columns}")


def cmd_demo_run(args: argparse.Namespace) -> int:
    from wise_workbench.container import Container
    from wise_workbench.domain import RunParams, Slicing, slicing_id

    c = Container(_settings(args))
    project = _demo_project(c)
    tables = [t for t in c.mappings.list_case_tables(project.id) if str(t.status) == "ready"]
    if args.case_table:
        tables = [t for t in tables if t.id == args.case_table]
    if not tables:
        print("no ready case table in the demo project; run `wise-workbench demo ingest --csv ...` first")
        return 1
    table = tables[-1]
    norm_doc = json.loads(Path(args.norm).expanduser().read_text(encoding="utf-8"))
    existing = [n for n in c.norms.list(project.id) if n.document.get("name") == norm_doc.get("name")]
    norm = None
    for cand in existing:
        _canonical, fingerprint = c.engine.validate_norm(norm_doc)
        if cand.fingerprint == fingerprint:
            norm = cand
            break
    if norm is None:
        norm = c.norms.create_version(project.id, norm_doc, note=f"imported from {Path(args.norm).name}")
    print(
        f"Case table {table.id} ({table.cases:,} cases); norm {norm.name} v{norm.version} fingerprint {norm.fingerprint[:12]}",
        file=sys.stderr,
    )
    columns = list(table.attributes)
    attrs = [_resolve_attribute(a.strip(), columns) for a in args.slicing.split(",") if a.strip()]
    slicing = Slicing(id=slicing_id(attrs), attributes=tuple(attrs))
    view = args.view or norm.view_names[0]
    params = RunParams(
        case_table_id=table.id,
        norm_version_id=norm.id,
        views=tuple(norm.view_names),
        slicings=(slicing,),
        gamma=float(args.gamma),
        min_cases=int(args.min_cases),
    )
    run, _job, created = c.runs.create(project.id, params)
    if created:
        _drain(c, "score_run")
    else:
        print(f"identical inputs: reusing run {run.id}", file=sys.stderr)
    run = c.runs.get(project.id, run.id)
    if str(run.status) != "done":
        print(f"run {run.id} is {run.status}: {run.error}")
        return 1
    page = c.runs.backlog(
        project.id,
        run.id,
        slicing=slicing.id,
        view=view,
        gamma=None,
        min_cases=int(args.min_cases),
        sort="-stable_PI",
        hotspot_type=None,
        layer=None,
        q=None,
        page=1,
        page_size=int(args.top),
    )
    m = run.manifest
    print(f"\nRun {run.id}: view {view}, slicing {' × '.join(attrs)}, γ = {args.gamma:g}, min_cases = {args.min_cases}")
    if m:
        print(
            f"  norm {m.norm_fingerprint[:12]}  log {m.content_hash[:12]}  params {m.params_hash[:12]}  wise {m.wise_version}"
        )
    print(f"  global mean {page['globalMean']:.4f}; {page['total']} slices with at least {args.min_cases} cases\n")
    key_w = max(12, min(48, max((len(" × ".join(r["keys"].values())) for r in page["rows"]), default=12)))
    print(
        f"{'rank':>4}  {'slice':{key_w}}  {'n_cases':>8}  {'gap':>7}  {'stable_gap':>10}  {'PI':>9}  {'stable_PI':>9}  {'hotspot':9}  dominant layer"
    )
    for r in page["rows"]:
        label = " × ".join(r["keys"].values())[:key_w]
        print(
            f"{r['rank']:>4}  {label:{key_w}}  {r['n_cases']:>8,}  {r['gap']:7.4f}  {r['stable_gap']:10.4f}  {r['PI']:9.1f}  {r['stable_PI']:9.1f}  "
            f"{(r.get('hotspot_type') or '-'):9}  {r.get('dominant_layer') or '-'}"
        )
    return 0


# ----------------------------------------------------------------------------- parser
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="wise-workbench", description="WISE Workbench backend")
    parser.add_argument("--version", action="version", version=f"wise-workbench {__version__}")
    parser.add_argument("--workspace", help="workspace directory (default: WISE_WORKSPACE or ~/WISE Workbench)")
    parser.add_argument(
        "--log-format", choices=["json", "console"], help="log renderer (default: WISE_LOG_FORMAT or json)"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    s = sub.add_parser(
        "serve",
        help="run the API and the built frontend (with the in-process worker unless WISE_INPROCESS_WORKER=0)",
    )
    s.add_argument("--host")
    s.add_argument("--port", type=int)
    s.add_argument("--no-worker", action="store_true", help="do not start the in-process worker")
    s.add_argument("--open", action="store_true", help="open the application in the default browser once it answers")
    s.add_argument(
        "--static", help="directory with the built frontend (default: WISE_STATIC_DIR, then apps/frontend/dist)"
    )
    s.set_defaults(func=cmd_serve)

    w = sub.add_parser("worker", help="run a worker process")
    w.add_argument("--once", action="store_true", help="drain the queue and exit")
    w.add_argument("--max-jobs", type=int, default=None)
    w.add_argument("--worker-id", default=None)
    w.set_defaults(func=cmd_worker)

    m = sub.add_parser("migrate", help="apply database migrations")
    m.set_defaults(func=cmd_migrate)

    o = sub.add_parser("openapi", help="print the OpenAPI document")
    o.add_argument("--yaml", action="store_true")
    o.add_argument("--out")
    o.set_defaults(func=cmd_openapi)

    h = sub.add_parser("health", help="call the running API's health endpoint")
    h.add_argument("--url")
    h.set_defaults(func=cmd_health)

    d = sub.add_parser("demo", help="end-to-end demo on a CSV")
    dsub = d.add_subparsers(dest="demo_command", required=True)
    di = dsub.add_parser("ingest", help="ingest a CSV, build the case table, print the readiness report")
    di.add_argument("--csv", required=True)
    di.add_argument("--case")
    di.add_argument("--activity")
    di.add_argument("--timestamp")
    di.add_argument("--timestamp-format")
    di.add_argument("--attr", action="append", help="case attribute column (repeatable)")
    di.set_defaults(func=cmd_demo_ingest)
    dr = dsub.add_parser("run", help="score the latest demo case table and print the top slices")
    dr.add_argument("--norm", required=True)
    dr.add_argument(
        "--slicing",
        required=True,
        help="attribute or comma-separated attributes (aliases: vendor, company, spend_area)",
    )
    dr.add_argument("--view")
    dr.add_argument("--gamma", type=float, default=20.0)
    dr.add_argument("--min-cases", type=int, default=20)
    dr.add_argument("--top", type=int, default=10)
    dr.add_argument("--case-table")
    dr.set_defaults(func=cmd_demo_run)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
