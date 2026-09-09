"""Download public event logs listed in packages/process-knowledge/src/wise_knowledge/data/datasets.yaml.

Resolves each 4TU DOI to an article or collection, lists its files through the
4TU API, downloads them with MD5 verification into a data directory outside
the repository, and writes a small manifest per dataset.

    python tools/fetch_public_logs.py --data ~/wise-workbench-data bpic2012 sepsis
    python tools/fetch_public_logs.py --data ~/wise-workbench-data --all
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

API = "https://data.4tu.nl/v2"


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "wise-workbench/0.0"})
    with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310
        return r.read()


def _resolve(doi: str) -> tuple[str, int]:
    """Return ('articles' | 'collections', id) for a 4TU DOI."""
    req = urllib.request.Request(f"https://doi.org/{doi}", method="HEAD",
                                 headers={"User-Agent": "wise-workbench/0.0"})
    with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310
        final = r.geturl()
    m = re.search(r"/(articles|collections)/(?:[^/]+/)?(\d+)", final)
    if not m:
        raise SystemExit(f"cannot resolve {doi}: {final}")
    return m.group(1), int(m.group(2))


def _files(kind: str, ident: int) -> list[dict]:
    if kind == "articles":
        return json.loads(_get(f"{API}/articles/{ident}/files"))
    arts = json.loads(_get(f"{API}/collections/{ident}/articles?page_size=100"))
    out: list[dict] = []
    for a in arts:
        for f in json.loads(_get(f"{API}/articles/{a['id']}/files")):
            f["article_title"] = a.get("title")
            out.append(f)
    return out


def _download(url: str, dest: Path, md5: str | None) -> None:
    if dest.exists() and (not md5 or hashlib.md5(dest.read_bytes()).hexdigest() == md5):  # noqa: S324
        print(f"  exists  {dest.name}")
        return
    print(f"  fetch   {dest.name}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "wise-workbench/0.0"})
    h = hashlib.md5()  # noqa: S324
    with urllib.request.urlopen(req, timeout=120) as r, tmp.open("wb") as w:  # noqa: S310
        while chunk := r.read(1 << 20):
            w.write(chunk)
            h.update(chunk)
    if md5 and h.hexdigest() != md5:
        tmp.unlink()
        raise SystemExit(f"checksum mismatch for {dest.name}")
    tmp.rename(dest)


def load_registry(path: Path) -> dict[str, dict]:
    try:
        import yaml  # type: ignore
        data = yaml.safe_load(path.read_text())
        return {d["id"]: d for d in data["datasets"]}
    except ImportError:
        # minimal fallback: id and doi only
        ids: dict[str, dict] = {}
        cur: dict | None = None
        for line in path.read_text().splitlines():
            m = re.match(r"\s*-\s+id:\s*(\S+)", line)
            if m:
                cur = {"id": m.group(1)}
                ids[m.group(1)] = cur
            elif cur is not None:
                m = re.match(r"\s+doi:\s*(\S+)", line)
                if m:
                    cur["doi"] = None if m.group(1) == "null" else m.group(1)
        return ids


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--registry", type=Path,
                    default=Path(__file__).resolve().parents[1] / "packages/process-knowledge/src/wise_knowledge/data/datasets.yaml")
    a = ap.parse_args()
    reg = load_registry(a.registry)
    ids = list(reg) if a.all else a.ids
    for i in ids:
        d = reg[i]
        doi = d.get("doi")
        if not doi or not str(doi).startswith("10.4121/"):
            print(f"{i}: no 4TU DOI, skipped")
            continue
        kind, ident = _resolve(doi)
        files = _files(kind, ident)
        out = a.data / i
        out.mkdir(parents=True, exist_ok=True)
        print(f"{i}: {kind} {ident}, {len(files)} files")
        manifest = []
        for f in files:
            _download(f["download_url"], out / f["name"], f.get("supplied_md5"))
            manifest.append({"name": f["name"], "size": f["size"], "md5": f.get("supplied_md5"),
                             "article": f.get("article_title")})
        (out / "manifest.json").write_text(json.dumps({"doi": doi, "files": manifest}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
