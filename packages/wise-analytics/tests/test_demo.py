"""The checkpoint demo runs and reports success."""

from __future__ import annotations

from wise_analytics import demo


def test_demo_runs(capsys):
    code = demo.main(["--n-cases", "1500", "--B", "50", "--seed", "1", "--quiet"])
    out = capsys.readouterr().out
    assert code == 0
    assert "all checks passed" in out and "planted artefact → check status:" in out and "MISSED" not in out
    assert "sum of bars" in out and "identity error" in out
