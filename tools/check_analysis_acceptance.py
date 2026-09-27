#!/usr/bin/env python3
"""GET-only, dataset-independent acceptance checks; emit aggregate JSON, never traces.

Exit 0: required functional checks passed; 1: a check failed; 2: required
checks unavailable. Contextual unavailable rows remain visible even on exit 0.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from itertools import pairwise
from typing import Any

FAMILIES = (
    "overview",
    "frequency",
    "repetition",
    "timing",
    "sequence",
    "boundaries",
    "identity",
    "missingness",
)


class Failure(Exception):
    """A response contradicts an acceptance criterion."""


class Unavailable(Exception):
    """There is insufficient evidence to execute a criterion."""


def require(condition: bool, message: str) -> None:
    # Deliberately not Python assert: production checks also run under python -O.
    if not condition:
        raise Failure(message)


def natural(value: Any, label: str) -> int:
    require(type(value) is int and value >= 0, f"{label} must be a non-negative integer")
    return value


def near(actual: Any, expected: float, label: str) -> None:
    require(
        type(actual) in (int, float)
        and math.isfinite(actual)
        and math.isclose(actual, expected, rel_tol=1e-8, abs_tol=1e-10),
        f"{label} denominator/count mismatch",
    )


def duration(value: Any, label: str) -> None:
    require(
        type(value) in (int, float) and math.isfinite(value) and value >= 0,
        f"{label} must be a finite non-negative number",
    )


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()


@dataclass
class Response:
    status: int
    data: Any


class ReadOnlyAPI:
    def __init__(self, base_url: str, timeout: float = 45):
        parsed = urllib.parse.urlsplit(base_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.query or parsed.fragment:
            raise ValueError("base URL must be an http(s) origin or API prefix without query/fragment")
        self.base = base_url.rstrip("/")
        if not self.base.endswith("/api/v1"):
            self.base += "/api/v1"
        self.timeout = timeout

    def get(self, path: str, **params: Any) -> Response:
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        request = urllib.request.Request(self.base + path + ("?" + query if query else ""), method="GET")
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                status, body = response.status, response.read()
        except urllib.error.HTTPError as exc:
            status, body = exc.code, exc.read()
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise Unavailable(f"API connection unavailable ({type(exc).__name__})") from exc
        try:
            data = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            data = None
        return Response(status, data)


def metrics(question: dict) -> dict:
    rows = question["metrics"]
    out = {row["id"]: row["value"] for row in rows}
    require(len(out) == len(rows), "duplicate metric identifiers")
    return out


def check_questions(data: dict, family: str, run_id: str) -> None:
    require(
        data["runId"] == run_id and data["family"] == family,
        "question run/family changed",
    )
    total = natural(data["totalCases"], "totalCases")
    selected = natural(data["selectedCases"], "selectedCases")
    require(selected <= total, "selection exceeds frozen run population")
    for name in ("activities", "attributes"):
        choice = data["choices"][name]
        values = choice["values"]
        require(
            isinstance(values, list) and all(isinstance(v, str) for v in values),
            "choices must be strings",
        )
        require(len(set(values)) == len(values) <= 100, "choices duplicated or unbounded")
        count = natural(choice["total"], "choice total")
        require(
            count >= len(values) and choice["truncated"] is (count > len(values)),
            "choice truncation/count mismatch",
        )
    require(0 < len(data["questions"]) <= 150, "missing or unbounded question profiles")
    for q in data["questions"]:
        require(family == "overview" or q["family"] == family, "profile family differs from selected question")
        require(
            q["family"] in FAMILIES and q["status"] in ("observed", "unavailable"),
            "untyped observation",
        )
        for key in ("measurement", "limitations", "contextNeeded", "nextCheck"):
            require(bool(q[key]), f"profile lacks {key}")
        m = metrics(q)
        affected = natural(m["affected_cases"], "affected_cases")
        require(affected <= selected, "affected cases exceed selected population")
        if selected:
            near(m["case_share"], affected / selected, "case_share")
        else:
            require(
                m["case_share"] is None,
                "empty population must not imply a measured share",
            )
        measured = natural(m["case_span_measured_cases"], "case_span_measured_cases")
        unmeasured = natural(m["case_span_unmeasured_cases"], "case_span_unmeasured_cases")
        require(
            measured + unmeasured == affected,
            "case-span clock coverage does not reconcile",
        )
        require(
            (m["median_case_span_hours"] is None) == (measured == 0),
            "case span imputes missing clocks",
        )
        if m["median_case_span_hours"] is not None:
            duration(m["median_case_span_hours"], "median_case_span_hours")
        known = natural(m["open_status_known_cases"], "open_status_known_cases")
        require(known <= affected, "open-status coverage exceeds affected cases")
        if m["open_cases"] is not None:
            require(
                natural(m["open_cases"], "open_cases") <= known,
                "open cases exceed known status",
            )


def require_sequence_predicates(filter_obj: dict) -> None:
    """Check decidability even when no variant rows were returned."""
    if not filter_obj["and"]:
        raise Unavailable("no activity-sequence predicate to verify")
    for clause in filter_obj["and"]:
        kind = clause["kind"]
        supported = (
            kind == "count"
            or (
                kind == "activity" and clause.get("op", "contains") in ("contains", "never", "starts_with", "ends_with")
            )
            or (kind == "follows" and clause.get("directly") is True)
        )
        if not supported:
            raise Unavailable(f"{kind} predicate requires evidence absent from activity-only variants")


def check_sequence_filter(sequence: list, filter_obj: dict) -> None:
    """Independent oracle for predicates decidable from a complete activity sequence."""

    def labels(value):
        return value if isinstance(value, list) else [value]

    require_sequence_predicates(filter_obj)
    for clause in filter_obj["and"]:
        kind = clause["kind"]
        if kind == "count":
            count = sum(step in labels(clause["activity"]) for step in sequence)
            matched = (clause.get("min") is None or count >= clause["min"]) and (
                clause.get("max") is None or count <= clause["max"]
            )
        elif kind == "activity":
            wanted = labels(clause["activity"])
            op = clause.get("op", "contains")
            boundaries = [step for step in sequence if step is not None]
            if op == "contains":
                matched = any(step in wanted for step in sequence)
            elif op == "never":
                matched = not any(step in wanted for step in sequence)
            elif op == "starts_with":
                matched = bool(boundaries) and boundaries[0] in wanted
            elif op == "ends_with":
                matched = bool(boundaries) and boundaries[-1] in wanted
            else:
                raise Unavailable("activity operator cannot be verified from this summary")
        elif kind == "follows" and clause.get("directly") is True:
            matched = any(a in labels(clause["a"]) and b in labels(clause["b"]) for a, b in pairwise(sequence))
            if clause.get("never") is True:
                matched = not matched
        else:
            raise Unavailable(f"{kind} predicate requires evidence absent from activity-only variants")
        require(matched, f"returned variant violates its {kind} selection predicate")


def check_variants(
    data: dict, expected: int, run_id: str, filter_obj: dict | None = None, *, requested_limit: int = 10
) -> None:
    require(data["runId"] == run_id, "variant run changed")
    require(
        natural(data["totalSelectedCases"], "totalSelectedCases") == expected,
        "variant cohort differs from filter/profile",
    )
    rows = data["variants"]
    if filter_obj is not None:
        require(data["filter"] == filter_obj, "variant response lost the requested filter")
        require_sequence_predicates(filter_obj)
    count = natural(data["coveredCount"], "coveredCount")
    excluded = natural(data["excludedZeroEventCases"], "excludedZeroEventCases")
    total = natural(data["totalVariants"], "totalVariants")
    limit = natural(data["limit"], "limit")
    require(
        type(requested_limit) is int and requested_limit > 0 and limit == requested_limit,
        "variant limit must match the requested positive limit",
    )
    require(len(rows) == min(total, limit), "variant top-list length mismatch")
    require(
        count == sum(natural(r["count"], "variant count") for r in rows),
        "coveredCount differs from returned variants",
    )
    require(count + excluded <= expected, "variant coverage exceeds cohort")
    eventful = expected - excluded
    require(bool(rows) == (eventful > 0), "eventful selected cases require nonempty variant evidence")
    require((total > 0) == (eventful > 0) and total <= eventful, "variant total contradicts eventful case support")
    if excluded and filter_obj is not None:
        check_sequence_filter([], filter_obj)
    if total <= limit:
        require(count + excluded == expected, "complete variants omit selected cases")
    near(data["coverage"], count / expected if expected else 0, "variant coverage")
    require(len({r["id"] for r in rows}) == len(rows), "duplicate variant identifiers")
    for row in rows:
        require(row["count"] > 0 and len(row["activities"]) > 0, "empty/zero-count variant")
        require(
            all(step is None or isinstance(step, str) for step in row["activities"]), "invalid variant activity type"
        )
        sequence = json.dumps(row["activities"], ensure_ascii=False, separators=(",", ":"))
        require(
            hashlib.sha256(sequence.encode()).hexdigest() == row["id"],
            "variant id does not preserve complete sequence",
        )
        near(row["share"], row["count"] / expected, "variant share")
        measured = natural(row["durationCases"], "durationCases")
        require(measured <= row["count"], "duration support exceeds variant count")
        require(
            (row["medianDurationHours"] is None) == (measured == 0),
            "variant duration imputes absent clocks",
        )
        if row["medianDurationHours"] is not None:
            duration(row["medianDurationHours"], "medianDurationHours")
        if filter_obj is not None:
            check_sequence_filter(row["activities"], filter_obj)
    require(
        bool(data["ordering"]) and bool(data["durationDescription"]),
        "variant ordering/span qualification absent",
    )


def check_repetition(frequency: dict, repetition: dict) -> None:
    f, r = metrics(frequency), metrics(repetition)
    for m in (f, r):
        for key in ("events", "activity_events", "repeated_cases", "extra_events"):
            natural(m[key], key)
    require(
        f["events"] == f["activity_events"] == r["activity_events"],
        "activity event totals disagree",
    )
    require(
        r["affected_cases"] == r["repeated_cases"] == f["repeated_cases"],
        "repetition case counts disagree",
    )
    require(
        f["extra_events"] == r["extra_events"] == f["events"] - f["affected_cases"],
        "extra events confused with affected cases",
    )
    require(
        r["events"] == r["affected_cases"] + r["extra_events"],
        "repetition events do not equal cases plus extras",
    )
    require(
        r["events"] >= 2 * r["affected_cases"] and r["affected_cases"] <= f["affected_cases"],
        "repetition violates at-least-two invariant",
    )


def check_timing(question: dict) -> None:
    m = metrics(question)
    pairs = natural(m["pairs"], "pairs")
    measured = natural(m["measured_pairs"], "measured_pairs")
    missing = natural(m["missing_clock_pairs"], "missing_clock_pairs")
    require(
        measured + missing == pairs,
        "measured and missing-clock pair counts do not reconcile",
    )
    require(
        natural(m["measured_cases"], "measured_cases") <= min(measured, m["affected_cases"]),
        "measured cases exceed pairs/affected cases",
    )
    require(m["affected_cases"] <= pairs, "affected cases exceed matched pairs")
    require(
        natural(m["equal_timestamp_pairs"], "equal_timestamp_pairs") <= measured,
        "equal timestamps exceed measured pairs",
    )
    if pairs:
        near(m["clock_coverage"], measured / pairs, "clock coverage")
    else:
        require(
            m["clock_coverage"] is None,
            "zero pairs must have unavailable clock coverage",
        )
    for key in ("median_hours", "p90_hours", "case_weighted_median_hours"):
        require(
            (m[key] is None) == (measured == 0),
            f"{key} imputes missing clocks or hides measurements",
        )
        if m[key] is not None:
            duration(m[key], key)
    if question["family"] == "timing":
        require(
            question["status"] == ("observed" if measured else "unavailable"),
            "unmeasured timing presented as observed",
        )
    words = " ".join(question["limitations"]).lower()
    require(
        "not active processing time" in words and "savings" in words,
        "timing lacks work/savings qualification",
    )
    if question["parameters"].get("relation") == "eventual":
        require(
            question["filter"] is None,
            "positional eventual relation cannot use timestamp-based broadening filter",
        )


def check_filtered_backlog(data: dict, filter_obj: dict, expected: int, view: str, fingerprint: str) -> None:
    """No whole-population analytics without an exact-scope provenance contract."""
    params = data["params"]
    require(params["filter"] == filter_obj and params["cases"] == expected, "backlog lost the exact filter/cohort")
    require(params["view"] == view and params["normFingerprint"] == fingerprint, "backlog view/norm changed")
    require(params["analytics_available"] is False, "filtered backlog claims unscoped cached analytics are available")
    require(params["analytics_record_ids"] == {}, "filtered backlog retains whole-run analytics record IDs")
    require(params["stability_applies"] is False, "whole-run bootstrap stability applied to a filtered cohort")
    require(bool(data["rows"]), "nonempty filtered backlog has no rows to verify")
    for row in data["rows"]:
        require(0 < natural(row["n_cases"], "backlog n_cases") <= expected, "backlog row exceeds selected cohort")
        for field in (
            "comparison",
            "comparison_kind",
            "comparison_constraint",
            "rank_lo",
            "rank_hi",
            "stable_PI_lo",
            "stable_PI_hi",
            "stable_gap_lo",
            "stable_gap_hi",
            "p_top",
        ):
            require(row.get(field) is None, f"filtered backlog retains unscoped {field}")
        reason = row.get("comparison_reason")
        require(
            isinstance(reason, dict) and bool(reason.get("code")) and bool(reason.get("text")),
            "uncomputed scoped comparison lacks a visible reason",
        )
        require(
            row["stability"] == "unknown" and row.get("kind_source") != "analytics",
            "filtered row retains an unscoped analytics classification",
        )
        require(
            isinstance(row.get("stability_reason"), str) and bool(row["stability_reason"].strip()),
            "uncomputed scoped stability lacks a visible reason",
        )
        for caveat in row.get("caveats", []):
            require(
                caveat.get("share") is None and caveat.get("page_share") is None,
                "filtered row retains quantitative caveats from an unscoped population",
            )


class Audit:
    def __init__(self, api: Any, project: str, run: str):
        self.api, self.project, self.run_id = api, project, run
        self.project_path = "/projects/" + urllib.parse.quote(project, safe="")
        self.path = self.project_path + "/runs/" + urllib.parse.quote(run, safe="")
        self.rows: list[dict] = []
        self.profiles: dict[str, dict] = {}

    def check(self, name: str, category: str, priority: str, fn: Callable) -> Any:
        try:
            value = fn()
        except Unavailable as exc:
            state, detail, value = "unavailable", str(exc), None
        except (Failure, KeyError, TypeError, ValueError, IndexError) as exc:
            state, detail, value = "fail", str(exc), None
        else:
            state, detail = "pass", "Criterion satisfied"
        self.rows.append(
            {
                "id": name,
                "category": category,
                "priority": priority,
                "status": state,
                "detail": detail,
            }
        )
        return value

    def get(self, suffix: str = "", **params: Any) -> dict:
        return self.object(self.api.get(self.path + suffix, **params))

    @staticmethod
    def object(response: Response) -> dict:
        if response.status in (429, 502, 503, 504):
            raise Unavailable(f"API temporarily unavailable (HTTP {response.status})")
        require(response.status == 200, f"expected HTTP 200, received {response.status}")
        require(isinstance(response.data, dict), "expected a JSON object")
        return response.data

    def questions(self, family: str, **params: Any) -> dict:
        data = self.get("/investigation-questions", family=family, limit=3, **params)
        check_questions(data, family, self.run_id)
        for field in ("source", "target", "relation"):
            if params.get(field) is not None:
                require(
                    all(q["parameters"].get(field) == params[field] for q in data["questions"]),
                    f"returned {field} differs from requested question",
                )
        if family in ("timing", "sequence"):
            for question in data["questions"]:
                check_timing(question)
        return data

    def snapshot(self) -> dict:
        run = self.get()
        require(run["id"] == self.run_id, "wrong run identity")
        if run["status"] != "done":
            raise Unavailable("target run is not complete")
        require(
            bool(run["paramsHash"]) and bool(run["manifest"]["normFingerprint"]),
            "missing frozen run/norm fingerprint",
        )
        norm = self.object(
            self.api.get(self.project_path + "/norms/" + urllib.parse.quote(run["normVersionId"], safe=""))
        )
        return {
            "run": digest(run),
            "norm": digest(norm),
            "population": run["manifest"]["cases"],
        }

    def reject(self, suffix: str, **params: Any) -> None:
        response = self.api.get(self.path + suffix, **params)
        if response.status in (429, 502, 503, 504):
            raise Unavailable(f"API temporarily unavailable (HTTP {response.status})")
        require(
            response.status == 422,
            f"invalid input must reject with HTTP 422; received {response.status}",
        )
        require(
            isinstance(response.data, dict),
            "rejection must contain a structured problem",
        )
        problem = response.data
        require(
            type(problem.get("status")) is int and problem["status"] == 422, "problem body status must match HTTP 422"
        )
        for field in ("code", "title", "detail"):
            require(
                isinstance(problem.get(field), str) and bool(problem[field].strip()),
                f"rejection problem lacks a meaningful {field}",
            )

    def execute(self) -> dict:
        before = self.check("frozen_target", "integrity", "P0", self.snapshot)
        overview = self.check("family.overview", "successful", "P0", lambda: self.questions("overview"))
        if overview is not None:
            self.profiles["overview"] = overview
            self.explore(overview)
        else:
            for family in FAMILIES[1:]:
                self.check(
                    "family." + family,
                    "successful",
                    "P0",
                    lambda: self.no_evidence("overview/actual choices unavailable"),
                )
            for criterion in (
                "repetition_cases_events",
                "variant_coverage",
                "exact_scope_drill",
                "filtered_backlog_analytics_isolation",
                "timing_clock_qualifications",
                "empty_selection",
            ):
                self.check(
                    criterion,
                    "insufficient",
                    "P0",
                    lambda: self.no_evidence("overview/actual choices unavailable"),
                )
            for criterion in ("live_missing_clock_example", "identity_evidence"):
                self.check(
                    criterion,
                    "insufficient",
                    "context",
                    lambda: self.no_evidence("overview/actual choices unavailable"),
                )
        self.disallowed()
        after = self.check("frozen_target_after", "integrity", "P0", self.snapshot)

        def unchanged():
            if before is None or after is None:
                raise Unavailable("cannot compare both run/norm snapshots")
            require(
                before == after,
                "run/norm metadata or fingerprint changed during read-only exploration",
            )
            if overview is not None:
                require(
                    overview["totalCases"] == before["population"],
                    "discovery denominator differs from frozen run",
                )

        self.check("run_norm_unchanged", "integrity", "P0", unchanged)
        self.check(
            "stakeholder_comprehension",
            "insufficient",
            "context",
            lambda: self.no_evidence(
                "Functional tests do not measure real stakeholder comprehension or business validity"
            ),
        )
        counts = dict(Counter(row["status"] for row in self.rows))
        failed = [row["id"] for row in self.rows if row["status"] == "fail"]
        blocked = [row["id"] for row in self.rows if row["priority"] == "P0" and row["status"] == "fail"]
        unverified = [row["id"] for row in self.rows if row["priority"] == "P0" and row["status"] == "unavailable"]
        return {
            "schemaVersion": 1,
            "goal": "Typed observations retain exact scope and measured support through a bounded next check without changing the run or norm",
            "checkedAt": datetime.now(UTC).isoformat(),
            "project": self.project,
            "run": self.run_id,
            "status": "fail" if failed else "unavailable" if counts.get("unavailable") else "pass",
            "functionalGate": "blocked" if blocked else "unverified" if unverified else "passed",
            "exitCode": 1 if failed else 2 if unverified else 0,
            "population": overview["totalCases"] if overview else None,
            "choiceCounts": {k: v["total"] for k, v in overview["choices"].items()} if overview else None,
            "counts": counts,
            "p0Failures": blocked,
            "p0Unavailable": unverified,
            "matrix": self.rows,
        }

    @staticmethod
    def no_evidence(reason: str):
        raise Unavailable(reason)

    def explore(self, overview: dict) -> None:
        choices = overview["choices"]["activities"]["values"]
        activity = choices[0] if choices else None
        pair = next(
            (q["parameters"] for q in overview["questions"] if q["parameters"].get("source") is not None),
            {},
        )
        source, target = (
            pair.get("source", activity),
            pair.get("target", choices[-1] if choices else None),
        )
        for family in FAMILIES[1:]:
            params = {"activity": activity} if family in ("frequency", "repetition") else {}
            if family in ("timing", "sequence"):
                params = {"source": source, "target": target, "relation": "direct"}

            def fetch(family=family, params=params):
                if family in ("frequency", "repetition", "timing", "sequence") and activity is None:
                    raise Unavailable("no recorded activity choices in this run")
                data = self.questions(family, **params)
                require(
                    data["selectedCases"] == overview["selectedCases"] and data["totalCases"] == overview["totalCases"],
                    "families disagree on population",
                )
                require(
                    data["choices"] == overview["choices"],
                    "families disagree on actual choices",
                )
                return data

            data = self.check("family." + family, "successful", "P0", fetch)
            if data is not None:
                self.profiles[family] = data

        def repetition():
            if not all(k in self.profiles for k in ("frequency", "repetition")):
                raise Unavailable("frequency/repetition evidence unavailable")
            f, r = (self.profiles[k]["questions"][0] for k in ("frequency", "repetition"))
            require(
                f["parameters"]["activity"] == r["parameters"]["activity"] == activity,
                "chosen recorded activity ignored",
            )
            require(
                metrics(f)["affected_cases"] > 0,
                "actual activity choice does not occur",
            )
            check_repetition(f, r)

        self.check("repetition_cases_events", "successful", "P0", repetition)

        def variants():
            data = self.get("/variants", limit=10, exampleLimit=1)
            check_variants(data, overview["selectedCases"], self.run_id)
            if not overview["choices"]["activities"]["truncated"]:
                require(
                    all(a is None or a in choices for r in data["variants"] for a in r["activities"]),
                    "variant activity absent from actual choices",
                )

        self.check("variant_coverage", "successful", "P0", variants)
        self.check("exact_scope_drill", "successful", "P0", self.scope)
        self.check("filtered_backlog_analytics_isolation", "successful", "P0", self.backlog_scope)

        def timing():
            if "timing" not in self.profiles:
                raise Unavailable("timing profile unavailable")
            check_timing(self.profiles["timing"]["questions"][0])
            eventual = self.questions("timing", source=source, target=target, relation="eventual")
            check_timing(eventual["questions"][0])

        self.check("timing_clock_qualifications", "successful", "P0", timing)

        def missing_clocks():
            if "timing" not in self.profiles:
                raise Unavailable("timing profile unavailable")
            if metrics(self.profiles["timing"]["questions"][0])["missing_clock_pairs"] == 0:
                raise Unavailable("chosen live pair has no missing clocks; synthetic oracle tests cover this branch")

        self.check("live_missing_clock_example", "insufficient", "context", missing_clocks)

        def identity():
            if "identity" not in self.profiles:
                raise Unavailable("identity profile unavailable")
            q = self.profiles["identity"]["questions"][0]
            if q["status"] == "unavailable":
                raise Unavailable("mapped identity evidence unavailable; no human/automation inference supported")
            m = metrics(q)
            require(
                m["known_identity_events"] + m["missing_identity_events"] == m["events"],
                "identity coverage counts do not reconcile",
            )

        self.check("identity_evidence", "insufficient", "context", identity)
        self.check("empty_selection", "insufficient", "P0", lambda: self.empty(choices))

    def scope(self) -> None:
        candidates = [
            q
            for data in self.profiles.values()
            for q in data["questions"]
            if q["filter"] is not None and metrics(q)["affected_cases"] > 0
        ]
        if not candidates:
            raise Unavailable("no supported nonempty exact profile filter")
        q = min(candidates, key=lambda q: metrics(q)["affected_cases"])
        encoded = json.dumps(q["filter"])
        expected = metrics(q)["affected_cases"]
        preview = self.get("/filters/preview", filter=encoded)
        require(
            preview["cases_in"] == expected,
            "profile drill broadens/narrows preview cohort",
        )
        check_variants(
            self.get("/variants", filter=encoded, limit=10, exampleLimit=1),
            expected,
            self.run_id,
            q["filter"],
        )
        nested = self.questions("repetition", filter=encoded)
        require(
            nested["selectedCases"] == expected and nested["filter"] == q["filter"],
            "inherited selection lost",
        )
        require(
            preview["cases_in"] + preview["cases_out"] == nested["totalCases"],
            "preview does not reconcile with frozen population",
        )
        inherited = q["filter"]["and"]
        for child in nested["questions"][:3]:
            if child["filter"] is None:
                continue
            require(
                all(clause in child["filter"]["and"] for clause in inherited),
                "nested profile dropped inherited clauses",
            )
            matched = self.get("/filters/preview", filter=json.dumps(child["filter"]))
            require(
                matched["cases_in"] == metrics(child)["affected_cases"],
                "nested drill cohort differs from observation",
            )

    def backlog_scope(self) -> None:
        total = self.profiles["overview"]["totalCases"]
        candidates = [
            q
            for data in self.profiles.values()
            for q in data["questions"]
            if q["filter"] is not None and 0 < metrics(q)["affected_cases"] < total
        ]
        if not candidates:
            raise Unavailable("no supported strictly smaller nonempty cohort for backlog isolation")
        run = self.get()
        views = run.get("views") or run["manifest"].get("views") or []
        slicings = run.get("slicings") or []
        if not views or not slicings:
            raise Unavailable("target run has no configured perspective/grouping for backlog isolation")
        slicing = slicings[0].get("id") or ",".join(slicings[0]["attributes"])
        params = {"slicing": slicing, "view": views[0], "minCases": 1, "pageSize": 50}
        # Prime the ordinary read path before testing that a strict filter cannot reuse it.
        baseline = self.get("/backlog", **params)
        require(baseline["params"]["cases"] == total, "unfiltered backlog differs from frozen population")
        q = min(candidates, key=lambda q: metrics(q)["affected_cases"])
        filter_obj, expected = q["filter"], metrics(q)["affected_cases"]
        encoded = json.dumps(filter_obj)
        require(
            self.get("/filters/preview", filter=encoded)["cases_in"] == expected,
            "backlog selection differs from the affected profile",
        )
        data = self.get("/backlog", filter=encoded, **params)
        check_filtered_backlog(data, filter_obj, expected, views[0], run["manifest"]["normFingerprint"])

    def empty(self, choices: list[str]) -> None:
        if not choices:
            raise Unavailable("no activity available for provably contradictory count filter")
        # Valid clauses with mutually exclusive counts prove emptiness without inventing activity IDs.
        encoded = json.dumps(
            {
                "and": [
                    {"kind": "count", "activity": choices[0], "min": 1},
                    {"kind": "count", "activity": choices[0], "max": 0},
                ]
            }
        )
        data = self.questions("missingness", filter=encoded)
        require(
            data["selectedCases"] == 0,
            "contradictory valid filter fell back to whole population",
        )
        require(
            self.get("/filters/preview", filter=encoded)["cases_in"] == 0,
            "empty preview fell back",
        )
        check_variants(
            self.get("/variants", filter=encoded, limit=10, exampleLimit=1),
            0,
            self.run_id,
            json.loads(encoded),
        )

    def disallowed(self) -> None:
        overview = self.profiles.get("overview")
        choices = overview["choices"]["activities"]["values"] if overview else []
        activity = choices[0] if choices else None
        control = {"kind": "count", "activity": activity, "min": 1}

        def valid_control(endpoint, obj):
            if activity is None or "frequency" not in self.profiles:
                raise Unavailable("no recorded activity with measured frequency for valid filter control")
            expected = metrics(self.profiles["frequency"]["questions"][0])["affected_cases"]
            encoded = json.dumps(obj)
            if endpoint == "investigation-questions":
                data = self.questions("frequency", activity=activity, filter=encoded)
                actual = data["selectedCases"]
            elif endpoint == "variants":
                data = self.get("/variants", filter=encoded, limit=10, exampleLimit=1)
                check_variants(data, expected, self.run_id, {"and": [control]})
                actual = data["totalSelectedCases"]
            else:
                actual = self.get("/filters/preview", filter=encoded)["cases_in"]
            require(
                actual == expected and expected > 0, "valid filter control rejects or miscounts a recorded activity"
            )

        for form, obj in (("naked", control), ("canonical", {"and": [control]})):
            for endpoint in ("investigation-questions", "variants", "filters/preview"):
                self.check(
                    f"valid_filter.{form}.{endpoint}",
                    "successful",
                    "P0",
                    lambda endpoint=endpoint, obj=obj: valid_control(endpoint, obj),
                )
        invalid = {
            "blank": "",
            "malformed": "{",
            "nonobject": "7",
            "unknown_kind": json.dumps({"kind": "not_a_filter"}),
            "unknown_field": json.dumps({**control, "invented": True}),
            "canonical_unknown_field": json.dumps({"and": [{**control, "invented": True}]}),
            "canonical_unknown_kind": json.dumps({"and": [{"kind": "not_a_filter"}]}),
            "unknown_conjunction_field": json.dumps({"and": [control], "invented": True}),
            "fractional_count": json.dumps({"kind": "count", "activity": "x", "min": 1.5}),
            "invalid_follows_boolean": json.dumps({"kind": "follows", "a": "x", "b": "y", "never": "false"}),
            "unsupported_lag": json.dumps({"kind": "lag", "a": "x", "b": "y", "min": 0, "directly": True}),
            "unsupported_time": json.dumps({"kind": "time", "from": "2024-01-01", "active": True}),
            "malformed_time": json.dumps({"kind": "time", "field": "case_start", "from": "not-a-date"}),
        }
        for name, value in invalid.items():
            for endpoint in ("investigation-questions", "variants", "filters/preview"):

                def reject_filter(endpoint=endpoint, value=value, name=name):
                    if activity is None and name in (
                        "unknown_field",
                        "canonical_unknown_field",
                        "unknown_conjunction_field",
                    ):
                        raise Unavailable("no recorded activity for unknown-field probe and its valid control")
                    self.reject("/" + endpoint, filter=value)

                self.check(
                    f"reject.{name}.{endpoint}",
                    "disallowed",
                    "P0",
                    reject_filter,
                )
        for name, params in (
            ("unknown_family", {"family": "unrecognised"}),
            ("missing_endpoints", {"family": "timing"}),
            ("incompatible_parameters", {"family": "identity", "activity": "x"}),
        ):
            self.check(
                "reject." + name,
                "disallowed",
                "P0",
                lambda params=params: self.reject("/investigation-questions", **params),
            )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, help="Server origin or /api/v1 prefix")
    parser.add_argument("--project", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--timeout", type=float, default=45, help="Seconds per GET, maximum 60")
    args = parser.parse_args(argv)
    if not 0 < args.timeout <= 60:
        parser.error("timeout must be greater than zero and at most 60 seconds")
    try:
        api = ReadOnlyAPI(args.base_url, args.timeout)
    except ValueError as exc:
        parser.error(str(exc))
    result = Audit(api, args.project, args.run).execute()
    print(json.dumps(result, indent=2, allow_nan=False))
    return result["exitCode"]


if __name__ == "__main__":
    raise SystemExit(main())
