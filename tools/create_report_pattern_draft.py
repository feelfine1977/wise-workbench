"""Create an extended draft and a fresh evaluation through the existing API.

Dry-run by default. Restricted to the explicitly authorized isolated localhost
8010 workspace. No dataset uploads, mapping changes, PATCH, or direct DB access.
Run with apps/backend/.venv-next/bin/python; see the report-pattern README.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages/process-knowledge/src"))

from wise_knowledge.report_patterns import extend_report_patterns

PROJECT = "prj_0mtoq2jvx8mcfcg6j"
CASE_TABLE = "ct_0mtoq3xcgajce13jv"
BASE_NORM = "nv_0mtoq44v68e19ia7e"
BASE_RUN = "run_0muj1zfd96rqnvsdb"


def check_url(url: str) -> None:
    parsed = urlsplit(url)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"localhost", "127.0.0.1"}
        or parsed.port != 8010
        or parsed.username
        or parsed.password
        or parsed.path.rstrip("/") != "/api/v1"
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(
            "Only the authorized http://127.0.0.1:8010/api/v1 workspace is allowed"
        )


def collect_coverage(
    client, *, prefix: str, run_id: str, document: dict, signals: dict
) -> dict:
    """Aggregate-only coverage; distinguish finite native signals from scoring.

    Precedence's native count can be zero when its response is absent, even
    when missing_b='skip' excludes that case from scoring. Query that endpoint
    population explicitly instead of presenting raw-signal n as evaluated n.
    """
    rules = {r["id"]: r for r in document["constraints"]}
    rows = {}
    for cid, signal in signals.items():
        rule = rules[cid]
        measured = signal
        if rule["type"] == "precedence" and rule["params"].get("missing_b") == "skip":
            query = {
                "and": [
                    {
                        "kind": "activity",
                        "op": "contains",
                        "activity": rule["params"]["b"],
                    }
                ]
            }
            response = client.get(
                prefix + "/runs/" + run_id + "/signals/" + cid,
                params={"filter": json.dumps(query)},
            )
            response.raise_for_status()
            measured = response.json()
        stats = measured["stats"]
        n = int(stats["n"])
        share = stats.get("shareBeyondThreshold")
        # This catalogue only uses finite observed thresholds with missing
        # endpoints skipped. No censoring/presence/imputation arithmetic here.
        affected = round(n * share) if share is not None else 0 if n == 0 else None
        scope = int(signal["casesInScope"])
        rows[cid] = {
            "casesInScope": scope,
            "finiteNativeSignalCases": int(signal["stats"]["n"]),
            "casesEvaluated": n,
            "casesUnmeasuredInScope": scope - n,
            "candidateCases": affected,
            "candidateShareOfEvaluated": share,
            "threshold": signal["threshold"],
            "unit": signal["unit"],
            "median": stats.get("median"),
            "p95": stats.get("p95"),
            "countMethod": "Rounded finite-observation count × unrounded native threshold share; same positive-violation candidates for these rules.",
        }
    return rows


def execute(
    client,
    *,
    mapping: dict,
    output: Path,
    apply: bool = False,
    wait_seconds: float = 300,
) -> dict:
    """Client injection permits synthetic API-contract tests without a server."""
    import wise

    check_url(str(client.base_url))
    prefix = f"/projects/{PROJECT}"

    def get(path: str) -> dict:
        response = client.get(path)
        response.raise_for_status()
        return response.json()

    def post(path: str, data: dict, **kwargs) -> dict:
        # Central allowlist prevents a future accidental update of source state.
        if path not in {prefix + "/norms", prefix + "/runs"}:
            raise ValueError("Only new draft norms and new runs may be written")
        response = client.post(path, json=data, **kwargs)
        response.raise_for_status()
        return response.json()

    if apply and (output / "created.json").exists():
        raise ValueError(
            "A creation receipt already exists; inspect it before another API write"
        )
    baseline = get(prefix + "/norms/" + BASE_NORM)
    original_run = get(prefix + "/runs/" + BASE_RUN)
    if (
        baseline["id"] != BASE_NORM
        or len(baseline["norm"]["constraints"]) != 29
        or original_run["caseTableId"] != CASE_TABLE
        or original_run["normVersionId"] != BASE_NORM
        or original_run["status"] != "done"
    ):
        raise ValueError("Isolated workspace does not match the authorized baseline")
    inventory = get(prefix + "/norms/inventory?caseTableId=" + CASE_TABLE)
    document, report = extend_report_patterns(
        baseline["norm"],
        activity_mapping=mapping["activity_mapping"],
        attribute_mapping=mapping["attribute_mapping"],
        flow_values=mapping["flow_values"],
        available_activities=[a["label"] for a in inventory["activities"]],
        available_attributes=inventory["attributeNames"],
    )
    norm = wise.Norm.from_dict(document)
    norm.validate()
    assert document["constraints"][:29] == baseline["norm"]["constraints"]
    assert (
        document["views"][: len(baseline["norm"]["views"])] == baseline["norm"]["views"]
    )
    output.mkdir(parents=True, exist_ok=True)

    def save(name, data):
        (output / name).write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n"
        )

    save("draft-norm.json", document)
    save("mapping-and-gaps.json", report)
    result = {
        "status": "prepared",
        "baseNormId": BASE_NORM,
        "baseRunId": BASE_RUN,
        "constraints": len(document["constraints"]),
        "added": report["added_constraint_ids"],
        "fingerprint": norm.fingerprint(),
        "omitted": report["omitted"],
    }
    save("prepared.json", result)
    if not apply:
        return result

    # Persist a receipt immediately after each mutation. Never retry a POST on
    # timeout: an ambiguous write must be inspected using GET before proceeding.
    version = post(
        prefix + "/norms",
        {
            "norm": document,
            "parentId": BASE_NORM,
            "note": "Report-inspired diagnostic extension; draft screening thresholds and applicability require review. Original 29 rules and four views preserved. No owner or approval asserted.",
        },
    )
    result.update(
        {
            "status": "draft_created",
            "normVersionId": version["id"],
            "preparedFingerprint": result["fingerprint"],
            "fingerprint": version["fingerprint"],
        }
    )
    save("created.json", result)
    if version["status"] != "draft":
        raise ValueError("Created norm unexpectedly is not a draft")
    save("created-norm.json", version)
    body = {
        k: original_run[k]
        for k in ("caseTableId", "slicings", "gamma", "minCases", "scope")
    }
    body.update(
        {
            "normVersionId": version["id"],
            "views": [v["name"] for v in document["views"]],
            "baselineRunId": BASE_RUN,
            "note": "New evaluation of report-inspired draft candidates; original run retained. No confirmed defects, labor savings or contractual lateness inferred.",
        }
    )
    key = (
        "report-patterns-"
        + hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    )
    run = post(prefix + "/runs", body, headers={"Idempotency-Key": key})
    result.update({"runId": run["id"], "status": run["status"]})
    save("created.json", result)
    deadline = time.monotonic() + wait_seconds
    while run["status"] in {"running", "queued"} and time.monotonic() < deadline:
        time.sleep(1)
        run = get(prefix + "/runs/" + run["id"])
    result["status"] = run["status"]
    save("run.json", run)
    save("created.json", result)
    if run["status"] != "done":
        return result
    signals = {}
    for cid in report["added_constraint_ids"]:
        signal = get(prefix + "/runs/" + run["id"] + "/signals/" + cid)
        signals[cid] = signal
        save("signals.json", signals)
    save(
        "coverage.json",
        collect_coverage(
            client, prefix=prefix, run_id=run["id"], document=document, signals=signals
        ),
    )
    save("summary.json", get(prefix + "/runs/" + run["id"] + "/summary"))
    after_norm = get(prefix + "/norms/" + BASE_NORM)
    after_run = get(prefix + "/runs/" + BASE_RUN)
    result["originalNormUnchanged"] = after_norm["norm"] == baseline["norm"]
    result["originalRunUnchanged"] = after_run == original_run
    save("created.json", result)
    if not result["originalNormUnchanged"] or not result["originalRunUnchanged"]:
        raise ValueError("Baseline preservation check failed")
    return result


def main() -> int:
    import httpx

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://127.0.0.1:8010/api/v1")
    parser.add_argument(
        "--mapping",
        type=Path,
        default=ROOT
        / "packages/process-knowledge/src/wise_knowledge/data/p2p/mappings/bpic2019_report_patterns.json",
    )
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Create a new draft and run after reviewing the prepared draft",
    )
    parser.add_argument("--wait-seconds", type=float, default=300)
    args = parser.parse_args()
    check_url(args.api_url)
    with httpx.Client(
        base_url=args.api_url, trust_env=False, follow_redirects=False, timeout=60
    ) as client:
        result = execute(
            client,
            mapping=json.loads(args.mapping.read_text()),
            output=args.output,
            apply=args.apply,
            wait_seconds=args.wait_seconds,
        )
    print(json.dumps(result, indent=2))
    return 0 if result["status"] in {"prepared", "done"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
