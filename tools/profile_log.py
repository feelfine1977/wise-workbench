"""Profile an event log file: cases, events, activities, time span, attributes.

Supports XES (.xes, .xes.gz), CSV and zip archives containing either.

    python tools/profile_log.py path/to/log.xes.gz [--case-col c --act-col a --time-col t --sep ;]
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import sys
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

NS = "{http://www.xes-standard.org/}"


def profile_xes(fh) -> dict:
    cases = 0
    events = 0
    acts: Counter[str] = Counter()
    resources = 0
    lifecycles: Counter[str] = Counter()
    tmin = tmax = None
    ev_attrs: Counter[str] = Counter()
    case_attrs: Counter[str] = Counter()
    in_event = False
    for ev, el in ET.iterparse(fh, events=("start", "end")):
        tag = el.tag.replace(NS, "")
        if ev == "start":
            if tag == "event":
                in_event = True
            continue
        if tag == "event":
            events += 1
            in_event = False
            el.clear()
        elif tag in {"string", "date", "int", "float", "boolean", "id"}:
            key = el.get("key", "")
            if in_event:
                ev_attrs[key] += 1
                if key == "concept:name":
                    acts[el.get("value", "")] += 1
                elif key == "lifecycle:transition":
                    lifecycles[el.get("value", "")] += 1
                elif key == "org:resource":
                    resources += 1
                elif key == "time:timestamp":
                    v = el.get("value", "")
                    tmin = v if tmin is None or v < tmin else tmin
                    tmax = v if tmax is None or v > tmax else tmax
            else:
                case_attrs[key] += 1
        elif tag == "trace":
            cases += 1
            el.clear()
    return {
        "cases": cases, "events": events, "activities": len(acts),
        "top_activities": acts.most_common(8), "lifecycle": dict(lifecycles),
        "events_with_resource": resources, "time_min": tmin, "time_max": tmax,
        "event_attributes": sorted(k for k, n in ev_attrs.items()),
        "case_attributes": sorted(k for k, n in case_attrs.items() if k != "concept:name"),
    }


def profile_csv(fh, case_col, act_col, time_col, sep) -> dict:
    import pandas as pd
    if sep is None:
        head = fh.read(4096)
        fh.seek(0)
        text = head.decode("utf-8", "ignore") if isinstance(head, bytes) else head
        first = text.splitlines()[0] if text else ""
        sep = ";" if first.count(";") > first.count(",") else ","
    df = pd.read_csv(fh, sep=sep, low_memory=False, encoding_errors="ignore")
    cols = list(df.columns)
    def pick(name, cands):
        if name and name in cols:
            return name
        for c in cands:
            for col in cols:
                if col.lower().replace(" ", "").replace("_", "") == c:
                    return col
        return None
    cc = pick(case_col, ["caseid", "case", "caseconcept:name", "incidentid", "ticketid", "sr_number", "srnumber", "case:concept:name"])
    ac = pick(act_col, ["activity", "concept:name", "event", "activitytype", "incidentactivitytype", "status"])
    tc = pick(time_col, ["timestamp", "time:timestamp", "completetimestamp", "datestamp", "time", "starttimestamp", "startdate"])
    out = {"rows": int(len(df)), "columns": cols, "case_col": cc, "activity_col": ac, "time_col": tc}
    if cc:
        out["cases"] = int(df[cc].nunique())
    if ac:
        out["activities"] = int(df[ac].nunique())
        out["top_activities"] = df[ac].value_counts().head(8).to_dict()
    if tc:
        t = pd.to_datetime(df[tc], errors="coerce", format="mixed", dayfirst=False)
        out["time_min"], out["time_max"] = str(t.min()), str(t.max())
    return out


def open_any(path: Path):
    if path.suffix == ".zip":
        z = zipfile.ZipFile(path)
        names = [n for n in z.namelist() if not n.endswith("/")]
        return [(n, io.BytesIO(z.read(n))) for n in names]
    if path.name.endswith(".gz"):
        return [(path.name, gzip.open(path, "rb"))]
    return [(path.name, path.open("rb"))]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="+", type=Path)
    ap.add_argument("--case-col"); ap.add_argument("--act-col"); ap.add_argument("--time-col")
    ap.add_argument("--sep", default=None)
    a = ap.parse_args()
    for p in a.paths:
        for name, fh in open_any(p):
            lname = name.lower()
            if lname.endswith((".xes", ".xes.gz", ".mxml")):
                fh2 = gzip.open(fh) if lname.endswith(".gz") and not isinstance(fh, gzip.GzipFile) else fh
                r = profile_xes(fh2)
            elif lname.endswith(".csv"):
                r = profile_csv(fh, a.case_col, a.act_col, a.time_col, a.sep)
            else:
                continue
            print(f"== {p.name} :: {name}")
            print(json.dumps(r, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
