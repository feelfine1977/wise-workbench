"""Offline hand-counted fixtures and adversarial mutations for the GET-only gate."""

import copy
import hashlib
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

SPEC = importlib.util.spec_from_file_location(
    "analysis_acceptance", Path(__file__).resolve().parents[2] / "tools" / "check_analysis_acceptance.py"
)
checker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = checker
SPEC.loader.exec_module(checker)


def metric_rows(values):
    return [{"id": key, "value": value} for key, value in values.items()]


def question(family, affected=1, selected=3, extra=None, filter_obj=None):
    values = {
        "affected_cases": affected,
        "case_share": affected / selected if selected else None,
        "case_span_measured_cases": affected,
        "case_span_unmeasured_cases": 0,
        "median_case_span_hours": 2 if affected else None,
        "open_status_known_cases": 0,
        "open_cases": None,
    }
    values.update(extra or {})
    return {
        "id": family,
        "family": family,
        "status": "observed",
        "measurement": "Complete recorded sequences.",
        "parameters": {"activity": "A"},
        "metrics": metric_rows(values),
        "filter": filter_obj,
        "limitations": ["Elapsed time is not active processing time, savings or responsibility."],
        "contextNeeded": ["Process purpose and authorised exceptions."],
        "nextCheck": "Inspect selected paths.",
    }


CHOICES = {
    "activities": {"values": ["A", "B"], "total": 2, "truncated": False},
    "attributes": {"values": ["group"], "total": 1, "truncated": False},
}
REPEAT_FILTER = {"and": [{"kind": "count", "activity": "A", "min": 2}]}


class FixtureAPI:
    """Three hand-counted cases AAB, AB, B; mutations change only API responses."""

    def __init__(self, mutate=None):
        self.calls = []
        self.mutate = mutate
        self.snapshots = 0

    def get(self, path, **params):
        self.calls.append((path, params))
        response = self.response(path, params)
        if self.mutate:
            self.mutate(path, params, response, self)
        return response

    def response(self, path, p):
        def ok(data):
            return checker.Response(200, copy.deepcopy(data))

        if path.endswith("/norms/n"):
            return ok({"id": "n", "norm": {"expectations": []}})
        if path.endswith("/runs/r"):
            self.snapshots += 1
            return ok(
                {
                    "id": "r",
                    "status": "done",
                    "normVersionId": "n",
                    "views": ["Service"],
                    "slicings": [{"id": "group", "attributes": ["group"]}],
                    "paramsHash": "params",
                    "manifest": {"normFingerprint": "norm", "cases": 3},
                }
            )
        reject = checker.Response(
            422,
            {
                "status": 422,
                "code": "invalid",
                "title": "Invalid input",
                "detail": "This filter or question cannot be evaluated.",
            },
        )
        filter_obj = None
        selected_indexes = [0, 1, 2]
        selected = 3
        if "filter" in p:
            try:
                filter_obj = json.loads(p["filter"])
            except ValueError:
                return reject
            if not isinstance(filter_obj, dict):
                return reject
            if "and" not in filter_obj:
                filter_obj = {"and": [filter_obj]}
            if set(filter_obj) != {"and"} or not isinstance(filter_obj["and"], list):
                return reject
            # Hand-counted fixture: A occurs 2, 1, 0 times; B occurs once in each case.
            counts_by_activity = {"A": [2, 1, 0], "B": [1, 1, 1]}
            for clause in filter_obj["and"]:
                if (
                    not isinstance(clause, dict)
                    or clause.get("kind") != "count"
                    or set(clause) - {"kind", "activity", "min", "max"}
                    or clause.get("activity") not in counts_by_activity
                    or not any(bound in clause for bound in ("min", "max"))
                ):
                    return reject
                for bound in ("min", "max"):
                    if bound in clause and (type(clause[bound]) is not int or clause[bound] < 0):
                        return reject
                counts = counts_by_activity[clause["activity"]]
                selected_indexes = [
                    i
                    for i in selected_indexes
                    if counts[i] >= clause.get("min", 0) and ("max" not in clause or counts[i] <= clause["max"])
                ]
            selected = len(selected_indexes)
        if path.endswith("/filters/preview"):
            return ok({"cases_in": selected, "cases_out": 3 - selected})
        if path.endswith("/backlog"):
            filtered = filter_obj is not None
            return ok(
                {
                    "params": {
                        "cases": selected,
                        "filter": filter_obj,
                        "view": "Service",
                        "normFingerprint": "norm",
                        "analytics_available": not filtered,
                        "analytics_record_ids": {} if filtered else {"contrast": "whole-run"},
                        "stability_applies": not filtered,
                    },
                    "rows": [
                        {
                            "n_cases": selected,
                            "comparison": None if filtered else "83 here against 55 elsewhere",
                            "comparison_reason": {
                                "code": "not_computed",
                                "text": "No comparison computed for this selection.",
                            }
                            if filtered
                            else None,
                            "stability": "unknown" if filtered else "stable",
                            "stability_reason": "No stability computed for this selection."
                            if filtered
                            else "Cached bootstrap.",
                            "kind_source": "library" if filtered else "analytics",
                            "caveats": [],
                        }
                    ],
                }
            )
        if path.endswith("/variants"):
            sequences = [[["A", "A", "B"], ["A", "B"], ["B"]][i] for i in selected_indexes]
            rows = [
                {
                    "id": hashlib.sha256(json.dumps(seq, separators=(",", ":")).encode()).hexdigest(),
                    "activities": seq,
                    "count": 1,
                    "share": 1 / selected,
                    "durationCases": 1,
                    "medianDurationHours": 2,
                }
                for seq in sequences
            ]
            return ok(
                {
                    "runId": "r",
                    "filter": filter_obj,
                    "variants": rows,
                    "totalSelectedCases": selected,
                    "excludedZeroEventCases": 0,
                    "totalVariants": len(rows),
                    "coveredCount": selected,
                    "coverage": 1 if selected else 0,
                    "limit": 10,
                    "ordering": "stable recorded order",
                    "durationDescription": "Observed span, not savings",
                }
            )
        family = p.get("family", "overview")
        if (
            family not in checker.FAMILIES
            or (family == "timing" and "source" not in p)
            or (family == "identity" and "activity" in p)
        ):
            return reject
        q = question(family, selected, selected, filter_obj=filter_obj)
        a_counts = [[2, 1, 0][i] for i in selected_indexes]
        repeated = sum(n >= 2 for n in a_counts)
        extra = sum(max(n - 1, 0) for n in a_counts)
        if family in ("overview", "repetition"):
            q = question(
                "repetition",
                repeated,
                selected,
                {
                    "events": sum(n for n in a_counts if n >= 2),
                    "activity_events": sum(a_counts),
                    "repeated_cases": repeated,
                    "extra_events": extra,
                },
                REPEAT_FILTER,
            )
        if family == "frequency":
            q = question(
                family,
                sum(n >= 1 for n in a_counts),
                selected,
                {
                    "events": sum(a_counts),
                    "activity_events": sum(a_counts),
                    "repeated_cases": repeated,
                    "extra_events": extra,
                },
                {"and": [{"kind": "count", "activity": "A", "min": 1}]},
            )
        if family in ("timing", "sequence"):
            q = question(
                family,
                2,
                selected,
                {
                    "pairs": 2,
                    "measured_pairs": 1,
                    "missing_clock_pairs": 1,
                    "measured_cases": 1,
                    "equal_timestamp_pairs": 0,
                    "clock_coverage": 0.5,
                    "median_hours": 2,
                    "p90_hours": 2,
                    "case_weighted_median_hours": 2,
                },
            )
            q["parameters"] = {
                "source": p["source"],
                "target": p["target"],
                "relation": p["relation"],
            }
        if family == "identity":
            q = question(
                family,
                3,
                3,
                {"events": 6, "known_identity_events": 4, "missing_identity_events": 2},
            )
        return ok(
            {
                "runId": "r",
                "family": family,
                "totalCases": 3,
                "selectedCases": selected,
                "filter": filter_obj,
                "choices": CHOICES,
                "questions": [q],
            }
        )


def set_metric(response, key, value):
    for row in response.data["questions"][0]["metrics"]:
        if row["id"] == key:
            row["value"] = value


class AcceptanceTests(unittest.TestCase):
    def run_audit(self, mutate=None):
        api = FixtureAPI(mutate)
        return checker.Audit(api, "p", "r").execute(), api

    def assert_failed(self, mutate, criterion):
        report, _ = self.run_audit(mutate)
        self.assertIn(criterion, report["p0Failures"], report)
        self.assertEqual(report["exitCode"], 1)
        self.assertEqual(report["functionalGate"], "blocked")

    def test_hand_counted_success_has_real_checks_and_unavailable_comprehension(self):
        report, api = self.run_audit()
        self.assertEqual(report["p0Failures"], [], report)
        self.assertEqual(report["p0Unavailable"], [], report)
        self.assertEqual(report["functionalGate"], "passed")
        self.assertEqual(report["status"], "unavailable")
        self.assertEqual(report["exitCode"], 0)
        self.assertEqual(sum(row["id"].startswith("family.") for row in report["matrix"]), 8)
        self.assertEqual(
            {row["category"] for row in report["matrix"]},
            {"successful", "disallowed", "insufficient", "integrity"},
        )
        self.assertGreater(len(api.calls), 35)
        self.assertNotIn("exampleCaseIds", json.dumps(report))

    def test_case_event_confusion_blocks(self):
        def mutate(path, params, response, _):
            if params.get("family") == "repetition" and response.status == 200:
                set_metric(response, "events", 1)

        self.assert_failed(mutate, "repetition_cases_events")

    def test_activity_choices_must_occur(self):
        def mutate(path, params, response, _):
            if params.get("family") == "frequency" and response.status == 200:
                response.data["questions"][0]["parameters"]["activity"] = "invented"

        self.assert_failed(mutate, "repetition_cases_events")

    def test_scope_broadening_blocks(self):
        def mutate(path, params, response, _):
            if path.endswith("/filters/preview") and response.status == 200 and response.data["cases_in"] == 1:
                response.data["cases_in"] = 3

        self.assert_failed(mutate, "exact_scope_drill")

    def test_filtered_backlog_cannot_reuse_whole_run_analytics(self):
        def mutate(path, params, response, _):
            if path.endswith("/backlog") and "filter" in params:
                response.data["params"]["analytics_available"] = True
                response.data["params"]["analytics_record_ids"] = {"contrast": "whole-run"}

        self.assert_failed(mutate, "filtered_backlog_analytics_isolation")

    def test_unavailable_flag_cannot_hide_stale_backlog_evidence(self):
        mutations = (
            lambda d: d["params"].update(analytics_record_ids={"contrast": "whole-run"}),
            lambda d: d["rows"][0].update(comparison="83 here against 55 elsewhere"),
            lambda d: d["rows"][0].update(p_top=0.95),
            lambda d: d["rows"][0].update(kind_source="analytics"),
            lambda d: d["rows"][0].update(caveats=[{"share": 0.4, "page_share": 0.2}]),
            lambda d: d["rows"][0].update(comparison_reason=None),
        )
        for change in mutations:
            with self.subTest(change=change):

                def mutate(path, params, response, _, change=change):
                    if path.endswith("/backlog") and "filter" in params:
                        change(response.data)

                self.assert_failed(mutate, "filtered_backlog_analytics_isolation")

    def test_filtered_backlog_must_preserve_cohort_view_and_norm(self):
        for field, value in (("cases", 3), ("filter", None), ("view", "other"), ("normFingerprint", "other")):
            with self.subTest(field=field):

                def mutate(path, params, response, _, field=field, value=value):
                    if path.endswith("/backlog") and "filter" in params:
                        response.data["params"][field] = value

                self.assert_failed(mutate, "filtered_backlog_analytics_isolation")

    def test_missing_backlog_configuration_is_unavailable_not_pass(self):
        def mutate(path, params, response, _):
            if path.endswith("/runs/r"):
                response.data["slicings"] = []

        report, _ = self.run_audit(mutate)
        self.assertIn("filtered_backlog_analytics_isolation", report["p0Unavailable"])
        self.assertEqual(report["functionalGate"], "unverified")

    def test_wrong_variant_denominator_blocks(self):
        def mutate(path, params, response, _):
            if path.endswith("/variants") and response.status == 200:
                response.data["coverage"] = 0.1

        self.assert_failed(mutate, "variant_coverage")

    def test_collapsing_repeated_activity_changes_variant_identity(self):
        def mutate(path, params, response, _):
            if path.endswith("/variants") and response.status == 200 and response.data["variants"]:
                response.data["variants"][0]["activities"] = ["A", "B"]

        self.assert_failed(mutate, "variant_coverage")

    def test_missing_clock_imputation_blocks(self):
        def mutate(path, params, response, _):
            if params.get("family") == "timing" and response.status == 200:
                set_metric(response, "measured_pairs", 0)
                set_metric(response, "missing_clock_pairs", 2)
                set_metric(response, "measured_cases", 0)
                set_metric(response, "clock_coverage", 0)

        self.assert_failed(mutate, "family.timing")

    def test_absent_timing_qualification_blocks(self):
        def mutate(path, params, response, _):
            if params.get("family") == "timing" and response.status == 200:
                response.data["questions"][0]["limitations"] = ["Potential savings."]

        self.assert_failed(mutate, "family.timing")

    def test_blank_filter_whole_population_fallback_blocks(self):
        def mutate(path, params, response, _):
            if params.get("filter") == "":
                response.status, response.data = 200, {"cases_in": 3}

        self.assert_failed(mutate, "reject.blank.variants")

    def test_server_error_is_not_a_valid_rejection(self):
        def mutate(path, params, response, _):
            if params.get("filter") == "{":
                response.status = 500

        self.assert_failed(mutate, "reject.malformed.filters/preview")

    def test_malformed_timestamp_must_be_422_not_500(self):
        def mutate(path, params, response, _):
            if "not-a-date" in params.get("filter", ""):
                response.status = 500

        self.assert_failed(mutate, "reject.malformed_time.filters/preview")

    def test_unknown_filter_field_cannot_be_silently_ignored(self):
        def mutate(path, params, response, _):
            if "invented" in params.get("filter", ""):
                response.status, response.data = 200, {}

        self.assert_failed(mutate, "reject.unknown_field.investigation-questions")

    def test_all_missing_clocks_are_explicitly_unavailable_without_imputation(self):
        q = question(
            "timing",
            1,
            3,
            {
                "pairs": 2,
                "measured_pairs": 0,
                "missing_clock_pairs": 2,
                "measured_cases": 0,
                "equal_timestamp_pairs": 0,
                "clock_coverage": 0,
                "median_hours": None,
                "p90_hours": None,
                "case_weighted_median_hours": None,
            },
        )
        q["status"] = "unavailable"
        checker.check_timing(q)
        q["status"] = "observed"
        with self.assertRaises(checker.Failure):
            checker.check_timing(q)

    def test_top_variants_may_be_partial_but_cannot_claim_full_coverage(self):
        data = FixtureAPI().get("/variants").data
        data.update(variants=data["variants"][:1], limit=1, coveredCount=1, coverage=1 / 3)
        checker.check_variants(data, 3, "r", requested_limit=1)
        data["coverage"] = 1
        with self.assertRaises(checker.Failure):
            checker.check_variants(data, 3, "r", requested_limit=1)

    def test_empty_cohort_must_not_fallback(self):
        def mutate(path, params, response, _):
            if response.status == 200 and response.data.get("selectedCases") == 0:
                response.data["selectedCases"] = 3

        self.assert_failed(mutate, "empty_selection")

    def test_run_or_norm_mutation_blocks_even_with_unchanged_id(self):
        for target in ("run", "norm"):
            with self.subTest(target=target):

                def mutate(path, params, response, api, target=target):
                    if api.snapshots >= 2 and path.endswith("/runs/r" if target == "run" else "/norms/n"):
                        response.data["changed"] = True

                self.assert_failed(mutate, "run_norm_unchanged")

    def test_context_missing_is_unavailable_not_pass(self):
        def mutate(path, params, response, _):
            if params.get("family") == "identity" and response.status == 200:
                response.data["questions"][0]["status"] = "unavailable"

        report, _ = self.run_audit(mutate)
        row = next(r for r in report["matrix"] if r["id"] == "identity_evidence")
        self.assertEqual(row["status"], "unavailable")
        self.assertEqual(report["functionalGate"], "passed")

    def test_unreachable_server_is_unverified_not_pass(self):
        class Offline:
            def get(self, *_args, **_kwargs):
                raise checker.Unavailable("offline")

        report = checker.Audit(Offline(), "p", "r").execute()
        self.assertEqual(report["functionalGate"], "unverified")
        self.assertEqual(report["exitCode"], 2)
        self.assertNotIn("pass", report["counts"])

    def test_check_functions_remain_active_under_optimization(self):
        # require is an explicit branch, not assert removed by Python's -O flag.
        with self.assertRaises(checker.Failure):
            checker.require(False, "must fail")

    def test_fixture_naked_and_canonical_count_controls_select_two_cases(self):
        clause = {"kind": "count", "activity": "A", "min": 1}
        for obj in (clause, {"and": [clause]}):
            for endpoint, count_field in (
                ("filters/preview", "cases_in"),
                ("variants", "totalSelectedCases"),
                ("investigation-questions", "selectedCases"),
            ):
                with self.subTest(obj=obj, endpoint=endpoint):
                    response = FixtureAPI().get("/" + endpoint, filter=json.dumps(obj))
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.data[count_field], 2)
                    if endpoint == "variants":
                        self.assertEqual(
                            [r["activities"] for r in response.data["variants"]], [["A", "A", "B"], ["A", "B"]]
                        )

    def test_fixture_rejects_naked_nested_and_root_unknown_fields(self):
        clause = {"kind": "count", "activity": "A", "min": 1}
        for obj in (
            {**clause, "invented": True},
            {"and": [{**clause, "invented": True}]},
            {"and": [clause], "invented": True},
        ):
            for endpoint in ("variants", "filters/preview", "investigation-questions"):
                self.assertEqual(FixtureAPI().get("/" + endpoint, filter=json.dumps(obj)).status, 422)

    def test_canonical_and_root_unknown_field_acceptance_blocks(self):
        for location, criterion in (("clause", "canonical_unknown_field"), ("root", "unknown_conjunction_field")):
            with self.subTest(location=location):

                def mutate(path, params, response, _, location=location):
                    try:
                        obj = json.loads(params.get("filter", "null"))
                    except ValueError:
                        return
                    if not isinstance(obj, dict) or "and" not in obj:
                        return
                    invalid = "invented" in obj if location == "root" else any("invented" in c for c in obj["and"])
                    if invalid:
                        response.status, response.data = 200, {}

                self.assert_failed(mutate, "reject." + criterion + ".variants")

    def test_blanket_rejection_of_valid_controls_blocks(self):
        def mutate(path, params, response, _):
            if "filter" in params and response.status == 200:
                response.status, response.data = (
                    422,
                    {"status": 422, "code": "invalid", "title": "Invalid", "detail": "Refused"},
                )

        self.assert_failed(mutate, "valid_filter.canonical.variants")

    def test_wrong_filtered_sequence_with_valid_hash_and_counts_blocks(self):
        def mutate(path, params, response, _):
            if path.endswith("/variants") and response.status == 200 and '"min": 2' in params.get("filter", ""):
                row = response.data["variants"][0]
                row["activities"] = ["B"]
                row["id"] = hashlib.sha256(json.dumps(["B"], separators=(",", ":")).encode()).hexdigest()

        self.assert_failed(mutate, "exact_scope_drill")

    def test_matching_cases_cannot_be_relabelled_as_zero_event_exclusions(self):
        def mutate(path, params, response, _):
            if path.endswith("/variants") and response.status == 200 and '"min": 2' in params.get("filter", ""):
                response.data.update(
                    variants=[],
                    totalVariants=0,
                    coveredCount=0,
                    coverage=0,
                    excludedZeroEventCases=response.data["totalSelectedCases"],
                )

        self.assert_failed(mutate, "exact_scope_drill")

    def test_zero_limit_cannot_hide_all_eventful_variant_evidence(self):
        def mutate(path, params, response, _):
            if path.endswith("/variants") and response.status == 200:
                response.data.update(
                    variants=[],
                    totalVariants=response.data["totalSelectedCases"],
                    coveredCount=0,
                    coverage=0,
                    excludedZeroEventCases=0,
                    limit=0,
                )

        self.assert_failed(mutate, "variant_coverage")

    def test_changed_positive_limit_is_also_refused(self):
        def mutate(path, params, response, _):
            if path.endswith("/variants") and response.status == 200:
                response.data["limit"] = 9

        self.assert_failed(mutate, "variant_coverage")

    def test_empty_sequence_predicates_are_safe_and_do_not_imply_events(self):
        for clause in (
            {"kind": "count", "activity": "A", "min": 2},
            {"kind": "activity", "op": "contains", "activity": "A"},
            {"kind": "activity", "op": "starts_with", "activity": "A"},
            {"kind": "activity", "op": "ends_with", "activity": "A"},
            {"kind": "follows", "a": "A", "b": "B", "directly": True},
        ):
            with self.subTest(clause=clause), self.assertRaises(checker.Failure):
                checker.check_sequence_filter([], {"and": [clause]})
        for clause in (
            {"kind": "count", "activity": "A", "max": 0},
            {"kind": "activity", "op": "never", "activity": "A"},
            {"kind": "follows", "a": "A", "b": "B", "directly": True, "never": True},
        ):
            checker.check_sequence_filter([], {"and": [clause]})

    def test_undecidable_predicate_is_unavailable_even_without_any_rows(self):
        for selected in (0, 3):
            for clause in (
                {"kind": "attribute", "field": "group", "eq": "X"},
                {"kind": "follows", "a": "A", "b": "B", "directly": False},
            ):
                obj = {"and": [clause]}
                data = FixtureAPI().get("/variants").data
                data.update(
                    filter=obj,
                    variants=[],
                    totalSelectedCases=selected,
                    totalVariants=0,
                    coveredCount=0,
                    coverage=0,
                    excludedZeroEventCases=selected,
                )
                with self.subTest(selected=selected, clause=clause), self.assertRaises(checker.Unavailable):
                    checker.check_variants(data, selected, "r", obj)

    def test_zero_event_cases_are_allowed_only_when_the_predicate_accepts_empty(self):
        obj = {"and": [{"kind": "count", "activity": "A", "max": 0}]}
        data = FixtureAPI().get("/variants").data
        data.update(filter=obj, variants=[], totalVariants=0, coveredCount=0, coverage=0, excludedZeroEventCases=3)
        checker.check_variants(data, 3, "r", obj)

    def test_wrong_timing_and_sequence_endpoints_and_relation_block(self):
        for family in ("timing", "sequence"):
            for field, wrong in (("source", "wrong source"), ("target", "wrong target"), ("relation", "eventual")):
                with self.subTest(family=family, field=field):

                    def mutate(path, params, response, _, family=family, field=field, wrong=wrong):
                        if response.status == 200 and params.get("family") == family:
                            response.data["questions"][0]["parameters"][field] = wrong

                    self.assert_failed(mutate, "family." + family)

        def eventual_as_direct(path, params, response, _):
            if response.status == 200 and params.get("relation") == "eventual":
                response.data["questions"][0]["parameters"]["relation"] = "direct"

        self.assert_failed(eventual_as_direct, "timing_clock_qualifications")

    def test_nonnumeric_negative_nonfinite_and_boolean_spans_block(self):
        for value in ("impossible", -42, float("nan"), float("inf"), float("-inf"), True, False):
            with self.subTest(value=value):

                def profile_mutation(path, params, response, _, value=value):
                    if response.status == 200 and "questions" in response.data:
                        set_metric(response, "median_case_span_hours", value)

                self.assert_failed(profile_mutation, "family.overview")

                def variant_mutation(path, params, response, _, value=value):
                    if response.status == 200 and path.endswith("/variants") and response.data["variants"]:
                        response.data["variants"][0]["medianDurationHours"] = value

                self.assert_failed(variant_mutation, "variant_coverage")
                for family in ("timing", "sequence"):

                    def timing_mutation(path, params, response, _, value=value, family=family):
                        if response.status == 200 and params.get("family") == family:
                            set_metric(response, "median_hours", value)

                    self.assert_failed(timing_mutation, "family." + family)

    def test_empty_or_malformed_422_problem_cannot_pass(self):
        for body in (
            {},
            {"code": "invalid"},
            {"status": 422, "code": "invalid", "title": "Invalid", "detail": " "},
            {"status": 200, "code": "invalid", "title": "Invalid", "detail": "Refused"},
        ):
            with self.subTest(body=body):

                def mutate(path, params, response, _, body=body):
                    if response.status == 422:
                        response.data = copy.deepcopy(body)

                self.assert_failed(mutate, "reject.blank.variants")

    def test_sequence_oracle_checks_predicates_independently_and_marks_unknowns_unavailable(self):
        for clause, good, bad in (
            ({"kind": "count", "activity": "A", "min": 2}, ["A", "A", "B"], ["B"]),
            ({"kind": "activity", "activity": "A", "op": "contains"}, ["A", "B"], ["B"]),
            ({"kind": "activity", "activity": "A", "op": "never"}, ["B"], ["A", "B"]),
            ({"kind": "activity", "activity": "A", "op": "starts_with"}, ["A", "B"], ["B", "A"]),
            ({"kind": "activity", "activity": "A", "op": "ends_with"}, ["B", "A"], ["A", "B"]),
            ({"kind": "follows", "a": "A", "b": "B", "directly": True}, ["A", "B"], ["B", "A"]),
            ({"kind": "follows", "a": "A", "b": "B", "directly": True, "never": True}, ["B", "A"], ["A", "B"]),
        ):
            checker.check_sequence_filter(good, {"and": [clause]})
            with self.assertRaises(checker.Failure):
                checker.check_sequence_filter(bad, {"and": [clause]})
        for clause in (
            {"kind": "attribute", "field": "group", "eq": "X"},
            {"kind": "time", "from": "2024-01-01"},
            {"kind": "open", "value": True},
            {"kind": "lag", "a": "A", "b": "B", "min": 1},
            {"kind": "follows", "a": "A", "b": "B", "directly": False},
        ):
            with self.assertRaises(checker.Unavailable):
                checker.check_sequence_filter(["A", "B"], {"and": [clause]})


class TransportTests(unittest.TestCase):
    def test_transport_is_get_only_and_preserves_blank_and_encoded_filters(self):
        seen = []

        class Reply(io.BytesIO):
            status = 200

        def urlopen(request, timeout):
            seen.append(request)
            return Reply(b'{"ok": true}')

        api = checker.ReadOnlyAPI("http://localhost:9999", timeout=1)
        with patch.object(checker.urllib.request, "urlopen", urlopen):
            api.get("/x", filter="")
            api.get("/x", filter='{"label":"A & B+é"}')
        self.assertTrue(all(request.get_method() == "GET" and request.data is None for request in seen))
        self.assertEqual(
            parse_qs(urlsplit(seen[0].full_url).query, keep_blank_values=True)["filter"],
            [""],
        )
        self.assertEqual(
            parse_qs(urlsplit(seen[1].full_url).query)["filter"],
            ['{"label":"A & B+é"}'],
        )

    def test_invalid_json_success_is_failure_not_unavailable(self):
        with self.assertRaises(checker.Failure):
            checker.Audit.object(checker.Response(200, None))

    def test_service_unavailability_not_conflated_with_contract_failure(self):
        with self.assertRaises(checker.Unavailable):
            checker.Audit.object(checker.Response(503, {}))
        with self.assertRaises(checker.Failure):
            checker.Audit.object(checker.Response(500, {}))


if __name__ == "__main__":
    unittest.main()
