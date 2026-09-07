"""One handler per job kind; importing this package registers the built-in kinds."""

from wise_workbench.domain import JobKind
from wise_workbench.jobs.registry import register

from . import analytics, build_cases, ingest, load_preset, score_run, whatif

register(str(JobKind.INGEST), ingest.run, ingest.on_final)
register(str(JobKind.BUILD_CASES), build_cases.run, build_cases.on_final)
register(str(JobKind.SCORE_RUN), score_run.run, score_run.on_final)
register(str(JobKind.LOAD_PRESET), load_preset.run, load_preset.on_final)
register(str(JobKind.ANALYTICS), analytics.run, analytics.on_final)
register(str(JobKind.WHATIF), whatif.run, whatif.on_final)

__all__ = ["analytics", "build_cases", "ingest", "load_preset", "score_run", "whatif"]
