"""Read-only live EDA smoke: python3 tools/smoke_eda.py --base-url http://127.0.0.1:8010.

Only GET requests; does not create mappings, rebuild datasets, score runs, or
write files. Prints aggregate counts, response size and latency, never case rows.
"""

from __future__ import annotations

import argparse
import json
import time
from urllib.parse import quote, urlencode
from urllib.request import urlopen


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--project-id")
    parser.add_argument("--case-table-id")
    args = parser.parse_args()
    base = args.base_url.rstrip("/") + "/api/v1"

    def get(path, params=None):
        start = time.perf_counter()
        with urlopen(base + path + ("?" + urlencode(params) if params else ""), timeout=60) as response:
            raw = response.read()
        return json.loads(raw), len(raw), round(time.perf_counter() - start, 3)

    def conserved(result):
        summary = result["summary"]
        assert result.get("trendOmittedEmptyMonths", -1) >= 0, (
            "Restart the backend to load the monthly timeline correction"
        )
        if result["trendMonthsPerBucket"] == 1:
            assert all(
                row["from"] is None or row["from"][:7] == row["to"][:7] == row["label"] for row in result["trend"]
            )
        for chart in ("trend", "spans", "categories"):
            if chart == "categories" and result["attribute"] is None:
                continue
            for population in ("total", "selected"):
                assert sum(row[population] for row in result[chart]) == summary["cases"][population], chart
        assert summary["knownSpanCases"] + summary["unknownSpanCases"] == summary["cases"]["selected"]
        assert result["details"]["total"] == summary["cases"]["selected"]
        assert len(result["details"]["rows"]) <= 25
        assert len(result["trend"]) <= 121 and len(result["categories"]) <= 22

    projects = [{"id": args.project_id}] if args.project_id else get("/projects")[0]
    checked = 0
    for project in projects:
        prefix = f"/projects/{quote(project['id'], safe='')}/case-tables"
        for table in get(prefix)[0]:
            if table["status"] != "ready" or (args.case_table_id and table["id"] != args.case_table_id):
                continue
            path = prefix + "/" + quote(table["id"], safe="") + "/eda"
            params = {"datasetId": table["datasetId"]}
            overview, size, elapsed = get(path, params)
            conserved(overview)
            clauses = []
            selected = overview
            category = next((row for row in overview["categories"] if row["kind"] == "value"), None)
            if category:
                clauses.append({"kind": "attribute", "field": overview["attribute"], "eq": category["value"]})
                params["filter"] = json.dumps({"and": clauses})
                selected = get(path, params)[0]
                conserved(selected)
                assert selected["summary"]["cases"]["selected"] == category["total"]
            period = next((row for row in selected["trend"] if row["from"] and row["selected"]), None)
            if period:
                clauses.append({"kind": "time", "field": "case_start", "from": period["from"], "to": period["to"]})
                params["filter"] = json.dumps({"and": clauses})
                selected = get(path, params)[0]
                conserved(selected)
                assert selected["summary"]["cases"]["selected"] == period["selected"]
            span = next((row for row in selected["spans"] if not row["missing"] and row["selected"]), None)
            if span:
                params["spanMin"] = span["min"]
                if span["max"] is not None:
                    params["spanMax"] = span["max"]
                selected = get(path, params)[0]
                conserved(selected)
                assert selected["summary"]["cases"]["selected"] == span["selected"]
            reset = get(path, {"datasetId": table["datasetId"]})[0]
            assert reset["summary"] == overview["summary"]
            print(
                json.dumps(
                    {
                        "projectId": project["id"],
                        "caseTableId": table["id"],
                        "cases": overview["summary"]["cases"]["total"],
                        "events": overview["summary"]["events"]["total"],
                        "monthBins": len([row for row in overview["trend"] if row["from"]]),
                        "monthsPerBucket": overview["trendMonthsPerBucket"],
                        "emptyMonthsOmitted": overview["trendOmittedEmptyMonths"],
                        "overviewBytes": size,
                        "overviewSeconds": elapsed,
                        "intersectionCases": selected["summary"]["cases"]["selected"],
                        "status": "PASS",
                    }
                )
            )
            checked += 1
    if not checked:
        raise SystemExit("No matching ready case table; nothing was checked.")


if __name__ == "__main__":
    main()
