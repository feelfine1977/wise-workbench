# apps/backend/src/wise_workbench/adapters/engine

The only module that imports `wise`. Builds `EventLog`/`Norm` from stored artefacts, calls `score`, `prioritize`, drivers, diagnostics; records `wise.__version__` and `Norm.fingerprint()` on every run; `compat.py` pins accepted norm schema versions.
