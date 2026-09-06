"""Read distinct activity keys from a CSV event log.

Only the key columns are read (``usecols``), so the 527 MB BPIC 2019 file
takes seconds with pandas; without pandas a streaming ``csv`` reader is used.
"""

from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path

from .matching import MatchKey, ObservedActivity

DEFAULT_LABEL_COLUMNS = ("activity", "Activity", "concept:name", "event concept:name", "type", "activity_name", "task")


def sniff_columns(path: str | Path, encoding: str | None = None, sep: str | None = None) -> list[str]:
    for enc in [encoding] if encoding else ["utf-8", "latin-1"]:
        try:
            with Path(path).open(encoding=enc, newline="") as fh:
                header = fh.readline()
            break
        except UnicodeDecodeError:
            continue
    else:  # pragma: no cover
        raise UnicodeDecodeError("csv", b"", 0, 1, "cannot decode header")
    delimiter = sep or csv.Sniffer().sniff(header, delimiters=",;\t|").delimiter
    return [c.strip() for c in next(csv.reader([header], delimiter=delimiter))]


def guess_label_column(columns: list[str]) -> str | None:
    for c in DEFAULT_LABEL_COLUMNS:
        if c in columns:
            return c
    return None


def _counts(path: Path, columns: list[str], encoding: str | None, sep: str | None) -> Counter[tuple[str, ...]]:
    try:
        import pandas as pd
    except ImportError:
        pd = None
    encodings = [encoding] if encoding else ["utf-8", "latin-1"]
    if pd is not None:
        for enc in encodings:
            try:
                df = pd.read_csv(path, usecols=columns, encoding=enc, sep=sep or ",", dtype=str, keep_default_na=False)
            except UnicodeDecodeError:
                continue
            df = df[columns]
            return Counter(tuple(row) for row in df.itertuples(index=False, name=None))
        raise UnicodeDecodeError("csv", b"", 0, 1, "cannot decode file")
    for enc in encodings:  # pragma: no cover - pandas is installed in dev
        try:
            counter: Counter[tuple[str, ...]] = Counter()
            with path.open(encoding=enc, newline="") as fh:
                reader = csv.DictReader(fh, delimiter=sep or ",")
                for row in reader:
                    counter[tuple((row.get(c) or "").strip() for c in columns)] += 1
            return counter
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("csv", b"", 0, 1, "cannot decode file")


def read_labels(
    path: str | Path, key: MatchKey, encoding: str | None = None, sep: str | None = None
) -> list[ObservedActivity]:
    """Distinct observed activity keys with their event counts, most frequent first."""
    p = Path(path)
    columns = key.columns()
    counts = _counts(p, columns, encoding, sep)
    out = []
    comps = list(key.components())
    for values, n in counts.most_common():
        label = values[0].strip()
        if not label:
            continue
        extra = {comp: (values[i + 1].strip() or None) for i, comp in enumerate(comps)}
        out.append(ObservedActivity(label=label, count=n, **extra))
    return out


__all__ = ["DEFAULT_LABEL_COLUMNS", "guess_label_column", "read_labels", "sniff_columns"]
