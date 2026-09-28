"""Dataset-adaptive, descriptive investigations over the exact run population.

No activity names, business policies, financial outcomes or execution modes are inferred.
The caller supplies a scoped/transformed EventLog and a selected frame index. All event
reductions are vectorized; only the bounded output profiles are assembled in Python.
"""

from __future__ import annotations

import hashlib
import json
from functools import cached_property
from typing import Any, Literal, cast

import numpy as np
import pandas as pd
import wise

from wise_workbench.domain import ValidationError

Family = Literal["overview", "frequency", "repetition", "timing", "sequence", "boundaries", "identity", "missingness"]
Relation = Literal["direct", "eventual"]
FAMILIES = ("overview", "frequency", "repetition", "timing", "sequence", "boundaries", "identity", "missingness")
CHOICE_LIMIT = 100
EXAMPLE_LIMIT = 3


def metric(id: str, label: str, value: Any, unit: str, note: str | None = None) -> dict[str, Any]:
    if value is None or pd.isna(value):
        value = None
    elif isinstance(value, np.integer):
        value = int(value)
    elif isinstance(value, np.floating):
        value = float(value)
    return {"id": id, "label": label, "value": value, "unit": unit, "note": note}


def validate_parameters(
    family: str, activity: str | None, source: str | None, target: str | None, relation: str | None
) -> None:
    if family not in FAMILIES or relation not in (None, "direct", "eventual"):
        raise ValidationError("Unknown investigation family or relation", code="investigation.parameters")
    if family in ("timing", "sequence"):
        if not source or not target or activity is not None:
            raise ValidationError(
                "Timing and sequence require source and target, without activity", code="investigation.parameters"
            )
    elif source is not None or target is not None or relation is not None:
        raise ValidationError(
            "Source, target and relation are only supported for timing and sequence", code="investigation.parameters"
        )
    if activity is not None and (not activity or family not in ("frequency", "repetition", "boundaries")):
        raise ValidationError(
            "Activity is only supported for frequency, repetition and boundaries", code="investigation.parameters"
        )


class _Investigation:
    def __init__(
        self,
        log: wise.EventLog,
        selected_ids: pd.Index,
        *,
        filter_obj: dict[str, Any] | None,
        resource_column: str | None,
        censored: pd.Series | None,
    ) -> None:
        self.log = log
        self.ids = pd.Index(selected_ids.astype(str).to_numpy(), dtype=object).unique()
        self.filter = filter_obj
        # Select only the columns this family uses, rather than copying the complete
        # event table. Object-index membership avoids Arrow string scalar iteration.
        columns = list(dict.fromkeys([log.case_col, log.activity_col, log.timestamp_col]))
        if resource_column and resource_column in log.events.columns:
            columns.append(resource_column)
        ev = log.events[list(dict.fromkeys(columns))]
        case_values = ev[log.case_col].astype(str).to_numpy()
        keep = self.ids.get_indexer(case_values) >= 0
        ev = ev.loc[keep]
        self.null_activity_tokens = set(ev.loc[ev[log.activity_col].isna(), log.activity_col].astype(str))
        # Object dtype preserves true missing labels (rather than the strings 'nan'/'None').
        labels = ev[log.activity_col].astype(str).astype(object).where(ev[log.activity_col].notna(), None)
        self.events = pd.DataFrame(
            {
                "case": case_values[keep],
                "activity": labels.to_numpy(),
                "time": ev[log.timestamp_col].reset_index(drop=True),
            }
        )
        self.resource_column = resource_column
        self.resource_available = bool(resource_column and resource_column in ev.columns)
        if self.resource_available:
            resource = ev[resource_column].astype("string").str.strip()
            self.events["identity"] = resource.where(resource.notna() & resource.ne("")).to_numpy()
        self.censored = censored.copy() if censored is not None else None
        if self.censored is not None:
            self.censored.index = self.censored.index.astype(str)
        grouped = self.events.groupby("case", sort=False, observed=True)
        clock = grouped["time"].agg(["min", "max", "size", "count"]).reindex(self.ids)
        self.spans = ((clock["max"] - clock["min"]).dt.total_seconds() / 3600).where(
            (clock["count"] == clock["size"]) & clock["size"].gt(0)
        )
        self.event_cases = pd.Index(self.events["case"].unique())
        self.ordering = (
            "Recorded event order is timestamp ascending (missing timestamps last), then the mapped order "
            "column when configured, then stable stored order. Equal timestamps do not establish business causality."
        )

    @cached_property
    def activity_cases(self) -> pd.DataFrame:
        return (
            self.events.groupby(["activity", "case"], sort=False, observed=True).size().rename("events").reset_index()
        )

    @cached_property
    def activity_groups(self) -> Any:
        return self.activity_cases.groupby("activity", sort=False, observed=True)

    @cached_property
    def activity_stats(self) -> pd.DataFrame:
        stats = self.activity_groups.agg(events=("events", "sum"), cases=("case", "size"))
        repeated = self.activity_cases[self.activity_cases["events"] >= 2]
        stats["repeatedCases"] = repeated.groupby("activity", sort=False).size()
        stats["repeatedCases"] = stats["repeatedCases"].fillna(0).astype(int)
        return stats

    @cached_property
    def activity_counts(self) -> pd.Series:
        return self.events["activity"].value_counts()

    @cached_property
    def starts(self) -> pd.Series:
        return self.events.drop_duplicates("case", keep="first").set_index("case")["activity"]

    @cached_property
    def ends(self) -> pd.Series:
        return self.events.drop_duplicates("case", keep="last").set_index("case")["activity"]

    def activity_ids(self, activity: str) -> pd.Index:
        # Pair-only investigations need endpoint presence, not counts of every
        # activity in every case. Reuse counts if an overview already built them.
        if "activity_groups" in self.__dict__:
            groups = self.activity_groups
            return (
                pd.Index(groups.get_group(activity)["case"]) if activity in groups.groups else pd.Index([], dtype=str)
            )
        return pd.Index(self.events.loc[self.events["activity"].eq(activity), "case"].unique())

    def inherited(self, clauses: list[dict[str, Any]]) -> dict[str, Any]:
        return {"and": [*list((self.filter or {}).get("and", [])), *clauses]}

    def examples(self, ids: pd.Index) -> list[str]:
        values = ids.astype(str).unique().to_numpy()
        # Partition only the bounded sample; sorting all affected IDs is unnecessary.
        if len(values) > EXAMPLE_LIMIT:
            values = np.partition(values, EXAMPLE_LIMIT - 1)[:EXAMPLE_LIMIT]
        return sorted(values.tolist())

    def support(self, ids: pd.Index) -> list[dict[str, Any]]:
        ids = ids.unique()
        spans = self.spans.reindex(ids).dropna()
        flags = self.censored.reindex(ids) if self.censored is not None else None
        return [
            metric("affected_cases", "Affected cases", len(ids), "cases"),
            metric(
                "case_share", "Share of selected cases", len(ids) / len(self.ids) if len(self.ids) else None, "share"
            ),
            metric(
                "median_case_span_hours",
                "Median observed first-to-last span",
                spans.median(),
                "hours",
                "Cases with every event timestamp present; descriptive elapsed time, not savings or active work time.",
            ),
            metric("case_span_measured_cases", "Cases with complete clocks", len(spans), "cases"),
            metric(
                "case_span_unmeasured_cases", "Cases without a complete observed span", len(ids) - len(spans), "cases"
            ),
            metric(
                "open_cases",
                "Right-censored cases near the observation window end",
                int(flags.fillna(False).sum()) if flags is not None else None,
                "cases",
                "Mapping-based flag: lacks closure and is active near the window end. False does not certify completion; unavailable without an evaluable closure rule.",
            ),
            metric(
                "open_status_known_cases",
                "Cases with an evaluated censoring flag",
                int(flags.notna().sum()) if flags is not None else 0,
                "cases",
            ),
        ]

    def question(
        self,
        family: str,
        title: str,
        summary: str,
        measurement: str,
        ids: pd.Index,
        *,
        parameters: dict[str, Any] | None = None,
        metrics: list[dict[str, Any]] | None = None,
        clauses: list[dict[str, Any]] | None = None,
        limitations: list[str] | None = None,
        status: str = "observed",
        rows: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        params = {"activity": None, "source": None, "target": None, "relation": None, **(parameters or {})}
        identity = json.dumps([family, title, params], sort_keys=True, ensure_ascii=False)
        caveats = [
            self.ordering,
            "Observed spans include waiting and open cases; they are not completion times or estimates of savings.",
            *(limitations or []),
        ]
        if self.censored is None:
            caveats.append("Open/closed status is unavailable because no closure rule can be evaluated for this run.")
        if clauses is None:
            caveats.append("No exact supported case filter represents this profile; drill links are unavailable.")
        return {
            "id": hashlib.sha256(identity.encode()).hexdigest()[:24],
            "family": family,
            "title": title,
            "status": status,
            "summary": summary,
            "measurement": measurement,
            "parameters": params,
            "metrics": [*(metrics or []), *self.support(ids)],
            "filter": self.inherited(clauses) if clauses is not None else None,
            "limitations": caveats,
            "contextNeeded": [
                "Confirm timestamp precision, event replication and the operational meaning of these recorded activities."
            ],
            "nextCheck": "Inspect sample traces and the exact common paths before interpreting this pattern.",
            "exampleCaseIds": self.examples(ids),
            "rows": rows or [],
        }

    def activity_profiles(self, family: str, activity: str | None, limit: int) -> list[dict[str, Any]]:
        stats = self.activity_stats.reset_index()
        sort = "repeatedCases" if family == "repetition" else "events"
        if activity is not None:
            labels = [activity]
        else:
            if family == "repetition":
                stats = stats[stats["repeatedCases"] > 0]
            labels = stats.sort_values([sort, "activity"], ascending=[False, True])["activity"].head(limit).tolist()
        out = []
        for label in labels:
            cases = (
                self.activity_groups.get_group(label)
                if label in self.activity_groups.groups
                else self.activity_cases.iloc[:0]
            )
            selected = cases[cases["events"] >= 2] if family == "repetition" else cases
            ids = pd.Index(selected["case"])
            events = int(selected["events"].sum())
            repetitions = int((cases["events"] - 1).clip(lower=0).sum())
            out.append(
                self.question(
                    family,
                    f"Repeated {label}" if family == "repetition" else f"Activity {label}",
                    f"{len(ids):,} selected cases contain {'repeated occurrences of' if family == 'repetition' else ''} {label}; {events:,} events in those cases.",
                    "Occurrences are counted per case over the complete recorded sequence. Repetition means at least two occurrences; extra events count occurrences beyond the first.",
                    ids,
                    parameters={"activity": label},
                    metrics=[
                        metric("events", "Events in affected cases", events, "events"),
                        metric("activity_events", "All selected occurrences", int(cases["events"].sum()), "events"),
                        metric("repeated_cases", "Cases with repetition", int((cases["events"] >= 2).sum()), "cases"),
                        metric("extra_events", "Occurrences beyond the first per case", repetitions, "events"),
                    ],
                    clauses=[{"kind": "count", "activity": label, "min": 2 if family == "repetition" else 1}],
                    limitations=[
                        "Repeated recordings do not by themselves establish rework, errors, cost or inappropriate behaviour."
                    ],
                )
            )
        return out

    def direct_pairs(self) -> pd.DataFrame:
        ev = self.events
        same = ev["case"].eq(ev["case"].shift(-1))
        pairs = pd.DataFrame(
            {
                "case": ev["case"],
                "source": ev["activity"],
                "target": ev["activity"].shift(-1),
                "hours": (ev["time"].shift(-1) - ev["time"]).dt.total_seconds() / 3600,
            }
        )
        return pairs.loc[same & pairs["source"].notna() & pairs["target"].notna()]

    def eventual_pairs(self, source: str, target: str) -> pd.DataFrame:
        ev = self.events
        # One activation per case, followed by the first target at a strictly later event position.
        first = ev.loc[ev["activity"].eq(source)].drop_duplicates("case", keep="first")
        targets = np.flatnonzero(ev["activity"].eq(target).to_numpy())
        if first.empty or not len(targets):
            return pd.DataFrame({"case": pd.Series(dtype=str), "hours": pd.Series(dtype=float)})
        where = np.searchsorted(targets, first.index.to_numpy(), side="right")
        candidate = targets[np.minimum(where, len(targets) - 1)]
        same = (where < len(targets)) & (ev["case"].to_numpy()[candidate] == first["case"].to_numpy())
        first = first.loc[same]
        last = ev.iloc[candidate[same]]
        hours = (last["time"].reset_index(drop=True) - first["time"].reset_index(drop=True)).dt.total_seconds() / 3600
        return pd.DataFrame({"case": first["case"].to_numpy(), "hours": hours.to_numpy()})

    def pair_profile(self, family: str, source: str, target: str, relation: str, pairs: pd.DataFrame) -> dict[str, Any]:
        ids = pd.Index(pairs["case"].unique())
        clock = pairs["hours"].dropna()
        measured_ids = pd.Index(pairs.loc[pairs["hours"].notna(), "case"].unique())
        per_case = pairs.groupby("case", sort=False)["hours"].median()
        source_ids = self.activity_ids(source)
        target_ids = source_ids if source == target else self.activity_ids(target)
        both = source_ids.intersection(target_ids)
        rule = (
            "Every adjacent source → target event pair in the same case; repeated pairs are counted separately."
            if relation == "direct"
            else "The first source occurrence per case → the first target at a strictly later recorded position. A target before the source is not a match. Identical endpoints require two distinct events."
        )
        # Eventual follows in the shared filter uses timestamp >=, which is not our strict
        # recorded-position relation (especially ties and identical endpoints). Never approximate it.
        exact_direct = relation == "direct" and not ({source, target} & self.null_activity_tokens)
        clauses = [{"kind": "follows", "a": source, "b": target, "directly": True}] if exact_direct else None
        absent = [label for label in dict.fromkeys([source, target]) if label not in self.activity_counts.index]
        status = "unavailable" if family == "timing" and clock.empty else "observed"
        reason = (
            f"No selected occurrences of: {', '.join(absent)}."
            if absent
            else (
                "No qualifying ordered pair in this selection."
                if pairs.empty
                else "No qualifying pair has both endpoint timestamps."
            )
        )
        return self.question(
            family,
            f"{source} → {target} ({relation})",
            reason
            if status == "unavailable"
            else f"{len(pairs):,} qualifying pairs in {len(ids):,} selected cases; {len(clock):,} pairs have measured clocks.",
            f"{rule} Timing uses observed target minus source in hours. Equal timestamps contribute zero duration without proving causal order. Medians are per pair; the case-weighted median is reported separately.",
            ids,
            parameters={"source": source, "target": target, "relation": relation},
            status=status,
            clauses=clauses,
            metrics=[
                metric("pairs", "Qualifying pairs", len(pairs), "pairs"),
                metric("source_cases", "Cases with source", len(source_ids), "cases"),
                metric("target_cases", "Cases with target", len(target_ids), "cases"),
                metric("missing_source_cases", "Cases without source", len(self.ids) - len(source_ids), "cases"),
                metric("missing_target_cases", "Cases without target", len(self.ids) - len(target_ids), "cases"),
                metric(
                    "both_without_match_cases",
                    "Cases with both endpoints but no qualifying pair",
                    len(both.difference(ids)),
                    "cases",
                ),
                metric("measured_pairs", "Pairs with both endpoint clocks", len(clock), "pairs"),
                metric("missing_clock_pairs", "Pairs with missing endpoint clocks", len(pairs) - len(clock), "pairs"),
                metric(
                    "clock_coverage", "Pair clock coverage", len(clock) / len(pairs) if len(pairs) else None, "share"
                ),
                metric("measured_cases", "Cases contributing measured pairs", len(measured_ids), "cases"),
                metric("equal_timestamp_pairs", "Pairs with equal timestamps", int(clock.eq(0).sum()), "pairs"),
                metric("median_hours", "Median pair elapsed time", clock.median(), "hours"),
                metric(
                    "p90_hours",
                    "90th percentile pair elapsed time",
                    clock.quantile(0.9) if len(clock) else None,
                    "hours",
                ),
                metric(
                    "case_weighted_median_hours", "Median of per-case median pair times", per_case.median(), "hours"
                ),
            ],
            limitations=[
                "Elapsed time is not active processing time, savings, a deadline breach or evidence of responsibility."
            ]
            + ([reason] if status == "unavailable" else []),
        )

    def frequent_pairs(self, limit: int) -> list[dict[str, Any]]:
        pairs = self.direct_pairs()
        groups = pairs.groupby(["source", "target"], sort=False, observed=True)
        ranked = (
            groups.size()
            .rename("pairs")
            .reset_index()
            .sort_values(["pairs", "source", "target"], ascending=[False, True, True])
            .head(limit)
        )
        return [
            self.pair_profile(
                "timing", str(row.source), str(row.target), "direct", groups.get_group((row.source, row.target))
            )
            for row in ranked.itertuples()
        ]

    def boundary_profiles(self, activity: str | None, limit: int) -> list[dict[str, Any]]:
        candidates = []
        for side, values in (("start", self.starts), ("end", self.ends)):
            for label, n in values.dropna().value_counts().items():
                if activity is None or activity == label:
                    candidates.append((int(n), str(label), side))
        candidates.sort(key=lambda row: (-row[0], row[1], row[2]))
        if activity is not None and not candidates:
            candidates = [(0, activity, "start"), (0, activity, "end")]
        out = []
        for n, label, side in candidates[:limit]:
            values = self.starts if side == "start" else self.ends
            ids = pd.Index(values.index[values.eq(label)])
            # Shared starts/ends predicates skip nulls. Raw boundaries do not: with null
            # boundary labels, claiming these predicates are exact would silently broaden.
            clauses = (
                [{"kind": "activity", "op": "starts_with" if side == "start" else "ends_with", "activity": label}]
                if values.notna().all()
                else None
            )
            out.append(
                self.question(
                    "boundaries",
                    f"Recorded {side}: {label}",
                    f"{n:,} selected cases have {label} as their recorded {side}.",
                    "First/last recorded event, without skipping missing activity labels; the log window may omit earlier or later work.",
                    ids,
                    parameters={"activity": label},
                    clauses=clauses,
                    metrics=[
                        metric(
                            "zero_event_cases",
                            "Selected cases without events",
                            len(self.ids) - len(self.event_cases),
                            "cases",
                        ),
                        metric(
                            "missing_boundary_cases",
                            f"Cases with missing {side} activity",
                            int(values.isna().sum()),
                            "cases",
                        ),
                    ],
                    limitations=[
                        "A recorded end does not prove operational completion; a recorded start need not be the true process beginning."
                    ],
                )
            )
        return out

    def identity_profile(self, limit: int) -> dict[str, Any]:
        ev = self.events
        has = ev["identity"].notna() if self.resource_available else pd.Series(False, index=ev.index)
        ids = self.ids
        rows = []
        if self.resource_available:
            stats = (
                ev.assign(known=has)
                .groupby("activity", sort=False, observed=True)
                .agg(events=("case", "size"), known=("known", "sum"), identities=("identity", "nunique"))
            )
            stats = stats.reset_index().sort_values(["events", "activity"], ascending=[False, True]).head(limit)
            for row in stats.itertuples():
                rows.append(
                    {
                        "label": row.activity,
                        "metrics": [
                            metric("events", "Events", row.events, "events"),
                            metric("known_identity_events", "Events with identity", row.known, "events"),
                            metric(
                                "missing_identity_events",
                                "Events without identity",
                                cast(int, row.events) - cast(int, row.known),
                                "events",
                            ),
                            metric("distinct_identities", "Distinct recorded identities", row.identities, "identities"),
                        ],
                    }
                )
        return self.question(
            "identity",
            "Execution identity availability",
            f"{int(has.sum()):,} of {len(ev):,} events have a recorded execution identity."
            if self.resource_available
            else "No mapped execution identity column is available in this run.",
            "Presence and distinct values in the mapped resource column. Blank/null values are unavailable; other values are recorded identifiers, not verified people or execution modes.",
            ids,
            status="observed" if self.resource_available else "unavailable",
            rows=rows,
            clauses=[],
            metrics=[
                metric("events", "Selected events", len(ev), "events"),
                metric(
                    "known_identity_events",
                    "Events with identity",
                    int(has.sum()) if self.resource_available else None,
                    "events",
                ),
                metric(
                    "missing_identity_events",
                    "Events without identity",
                    int((~has).sum()) if self.resource_available else None,
                    "events",
                ),
                metric(
                    "identity_coverage",
                    "Event identity coverage",
                    float(has.mean()) if len(ev) and self.resource_available else None,
                    "share",
                ),
                metric(
                    "distinct_identities",
                    "Distinct recorded identities",
                    int(ev["identity"].nunique()) if self.resource_available else None,
                    "identities",
                ),
                metric("total_activity_rows", "Activities with events", len(self.activity_counts), "activities"),
                metric("shown_activity_rows", "Activity rows shown", len(rows), "activities"),
            ],
            limitations=[
                "Identity labels do not establish a human actor, automation, authorisation or responsibility. No execution-mode classification is inferred."
            ],
        )

    def choices(self, case_attributes: list[str]) -> dict[str, Any]:
        activities = (
            self.activity_counts.rename_axis("activity")
            .rename("events")
            .reset_index()
            .sort_values(["events", "activity"], ascending=[False, True])
        )
        names = sorted(set(a for a in case_attributes if a in self.log.cases.columns))
        return {
            "activities": {
                "values": activities["activity"].head(CHOICE_LIMIT).tolist(),
                "total": len(activities),
                "truncated": len(activities) > CHOICE_LIMIT,
            },
            "attributes": {
                "values": names[:CHOICE_LIMIT],
                "total": len(names),
                "truncated": len(names) > CHOICE_LIMIT,
            },
        }

    def missingness_profile(self, choices: dict[str, Any], limit: int) -> dict[str, Any]:
        ev = self.events
        rows: list[dict[str, Any]] = [
            {
                "label": label,
                "metrics": [
                    metric("missing_events", "Missing events", int(ev[col].isna().sum()), "events"),
                    metric("total_events", "Selected events", len(ev), "events"),
                ],
            }
            for label, col in (("Activity", "activity"), ("Timestamp", "time"))
        ]
        if self.resource_available:
            rows.append(
                {
                    "label": f"Identity ({self.resource_column})",
                    "metrics": [
                        metric("missing_events", "Missing events", int(ev["identity"].isna().sum()), "events"),
                        metric("total_events", "Selected events", len(ev), "events"),
                    ],
                }
            )
        names = choices["attributes"]["values"][:limit]
        cases = self.log.cases.copy(deep=False)
        cases.index = cases.index.astype(str)
        # Attribute values are only needed by missingness, and only for shown rows.
        for name in names:
            series = cases[name].reindex(self.ids)
            missing = series.isna() | series.astype("string").str.strip().eq("").fillna(False)
            rows.append(
                {
                    "label": name,
                    "metrics": [
                        metric("missing_cases", "Missing cases", int(missing.sum()), "cases"),
                        metric("available_cases", "Available cases", int((~missing).sum()), "cases"),
                    ],
                }
            )
        return self.question(
            "missingness",
            "Recorded data coverage",
            f"{len(self.ids) - len(self.event_cases):,} selected cases have no events; {int(ev['time'].isna().sum()):,} events have missing timestamps.",
            "Null event activity/timestamp values, null or blank execution identities, and null/blank selected case attributes are counted separately. Missing clocks are not imputed.",
            self.ids,
            rows=rows,
            clauses=[],
            metrics=[
                metric("events", "Selected events", len(ev), "events"),
                metric(
                    "zero_event_cases", "Selected cases without events", len(self.ids) - len(self.event_cases), "cases"
                ),
                metric("missing_timestamp_events", "Events without timestamps", int(ev["time"].isna().sum()), "events"),
                metric(
                    "missing_activity_events",
                    "Events without activity labels",
                    int(ev["activity"].isna().sum()),
                    "events",
                ),
                metric(
                    "total_attribute_rows", "Available case attributes", choices["attributes"]["total"], "attributes"
                ),
                metric("shown_attribute_rows", "Attribute rows shown", len(names), "attributes"),
            ],
            limitations=[
                "Missing recorded data does not prove missing business work. Mapping-time replacements such as '(missing)' remain ordinary recorded labels."
            ],
        )


def investigation_questions(
    log: wise.EventLog,
    selected_ids: pd.Index,
    *,
    run_id: str,
    total_cases: int,
    case_noun: str = "cases",
    filter_obj: dict[str, Any] | None = None,
    family: Family = "overview",
    activity: str | None = None,
    source: str | None = None,
    target: str | None = None,
    relation: Relation | None = None,
    limit: int = 20,
    resource_column: str | None = None,
    case_attributes: list[str] | None = None,
    censored: pd.Series | None = None,
) -> dict[str, Any]:
    validate_parameters(family, activity, source, target, relation)
    if not 1 <= limit <= 50:
        raise ValidationError("limit must be between 1 and 50", code="investigation.limit")
    known = (
        set(log.events[log.activity_col].dropna().astype(str).unique())
        if any(v is not None for v in (activity, source, target))
        else set()
    )
    for value in (activity, source, target):
        if value is not None and value not in known:
            raise ValidationError(f"Activity {value!r} is not recorded in this run", code="investigation.activity")
    data = _Investigation(
        log,
        selected_ids,
        filter_obj=filter_obj,
        resource_column=resource_column if family in ("identity", "missingness") else None,
        censored=censored,
    )
    choices = data.choices(list(case_attributes if case_attributes is not None else log.cases.columns))
    questions = []
    if family in ("overview", "frequency", "repetition"):
        questions.extend(data.activity_profiles("repetition" if family == "overview" else family, activity, limit))
    if family == "overview":
        questions.extend(data.frequent_pairs(limit))
    if family in ("timing", "sequence"):
        assert source is not None and target is not None
        mode = relation or "direct"
        if mode == "direct":
            pairs = data.direct_pairs()
            pairs = pairs.loc[pairs["source"].eq(source) & pairs["target"].eq(target)]
        else:
            pairs = data.eventual_pairs(source, target)
        questions.append(data.pair_profile(family, source, target, mode, pairs))
    if family in ("overview", "boundaries"):
        questions.extend(data.boundary_profiles(activity, limit))
    if family == "identity":
        questions.append(data.identity_profile(limit))
    if family == "missingness":
        questions.append(data.missingness_profile(choices, limit))
    if not questions:
        questions.append(
            data.question(
                family,
                "No observed patterns in this selection",
                "No qualifying recorded pattern is available for this family and selection.",
                "Patterns require selected recorded events; empty support is not a positive finding.",
                pd.Index([], dtype=str),
                status="unavailable",
            )
        )
    return {
        "runId": run_id,
        "caseNoun": case_noun,
        "totalCases": total_cases,
        "selectedCases": len(data.ids),
        "filter": filter_obj,
        "family": family,
        "choices": choices,
        "questions": questions,
    }
