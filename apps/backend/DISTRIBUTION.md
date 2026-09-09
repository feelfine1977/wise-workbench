# Backend distribution and clean CI

The backend requires classic `wise-pm` 0.1.x and `wise-knowledge` 0.1.x. The
`full` extra adds `wise-analytics` 0.2.x (`analytics` is an equivalent extra).
The minimal profile includes the knowledge resources and core scoring but
has no analytics dependency: headroom reports unavailable values per layer,
contrast/subgroups are empty, and analytics availability is false. Full
provides constraint-level headroom, stability, contrast and provenance.
Neither profile selects or installs the actionability extension.

No package has a mandatory uv sibling-source override. Local development
can explicitly install a chosen classic source path; a release must name its
classic input. These instructions use the existing classic `v0.1.0` tag.
They do not modify any previously configured application environment.

## CI profiles

`.github/workflows/ci.yml` uses a fresh job for
each combination of Python **3.12 / 3.13** and profile **full / minimal**.
From the repository root, after checkout and setup-python:

```bash
python -m pip install --upgrade pip
python -m pip install 'git+https://github.com/feelfine1977/wise-pm.git@v0.1.0'
python -m pip install ./packages/process-knowledge -e './apps/backend[dev]'
# Run this line ONLY in the full job:
python -m pip install ./packages/wise-analytics
```

Set `PROFILE` to the matrix profile, then run from `apps/backend`:

```bash
ruff check src tests
ruff format --check src tests
mypy
python -m pytest -q --dependency-profile="$PROFILE"
wise-workbench openapi --yaml --out "$RUNNER_TEMP/openapi.yaml"
diff -u ../../packages/api-schema/openapi.yaml "$RUNNER_TEMP/openapi.yaml"
```

Keep the exact contract check on both Python versions. The backend gives
explicit Problem 422 responses the fixed description `Unprocessable Content`;
FastAPI-generated request-validation responses keep `Validation Error`.
No schema artifact regeneration is needed for this cleanup.

`WISE_TEST_PROFILE=full|minimal` selects the profile (the explicit
`--dependency-profile` flag takes precedence). `full` is pytest's default and errors before collection if analytics is
missing. `minimal` errors if analytics is installed. Only the three modules
that require the analytics synthetic generator are excluded in minimal;
full imports that dependency normally, so those product tests cannot silently
skip. The common API lifecycle explicitly checks both headroom contracts.
Dataset checks remain opt-in. The synthetic BPIC preset test always runs
using the public norm shipped with knowledge.

The ordinary backend test suite includes `tests/distribution/test_wheels.py`.
It builds a backend wheel containing a synthetic frontend, builds a knowledge
sdist and a wheel from that sdist, and installs both with pip into a temporary
target outside the repository. A fresh isolated interpreter verifies module
origins under that install, both packs and entry points, schemas, every norm
template, presets, database migration, SPA reload and nested static assets,
and API/docs precedence. Build input directories are removed before serving.
Dependencies come from the test environment; the packages under test come
from installed wheels. No real frontend build or private dataset is needed.

For the knowledge job, from the repository root in a separate environment:

```bash
python -m pip install 'git+https://github.com/feelfine1977/wise-pm.git@v0.1.0'
python -m pip install -e './packages/process-knowledge[dev]'
cd packages/process-knowledge
ruff check .
python -m pytest -q
wise-knowledge validate
```

Add `packages/wise-analytics/pyproject.toml` to the backend dependency cache
inputs.

## Build and install a release

Build the approved frontend separately using its documented build command.
From the repository root, with Python build tools in a dedicated build venv:

```bash
python -m pip install build
python tools/build_release.py --frontend-dist apps/frontend/dist --frontend-mode live --out release
python -m build --wheel --outdir release packages/process-knowledge
python -m build --wheel --outdir release packages/wise-analytics
```

The builder stages backend source and the supplied dist in a temporary
directory. It neither changes `apps/backend/src/wise_workbench/static` nor
runs npm. `index.html` is required; symlinked assets are rejected. All supplied
assets, including nested files and notices, must match the wheel byte for
byte. A sibling `.manifest.json` records the wheel SHA-256 and every frontend
file SHA-256. This establishes artifact identity, not reproducible ZIP
bytes or a dependency lock. Use `--no-isolation` only in a prepared build
environment with `build`, `setuptools>=77` and `wheel` installed.

Copy the release wheels to the target machine, create a fresh environment,
and install the explicitly chosen classic input and the supplied wheels:

```bash
python -m venv /tmp/workbench-release-env
/tmp/workbench-release-env/bin/python -m pip install \
  'git+https://github.com/feelfine1977/wise-pm.git@v0.1.0' release/*.whl
cd /tmp
/tmp/workbench-release-env/bin/wise-workbench --workspace /tmp/workbench-demo serve
```

The installed backend serves its bundled frontend without `--static` or a
source checkout. The knowledge wheel carries content, not datasets. Set
`WISE_BPIC19_CSV` to explicitly enable that dataset preset, or configure
`WISE_PRESET_DATA_DIRS` with a JSON list of local directories. The default
BPIC norm is the packaged public template; `WISE_BPIC19_NORM` can override it.
No author directory is searched by default.


## CI smoke for the actual frontend artifact

After downloading the live frontend artifact, use these commands from
repo root in the build job (Python 3.12 or 3.13):

```bash
python -m pip install build
python tools/build_release.py --frontend-dist "$RUNNER_TEMP/frontend-dist" --frontend-mode live --out "$RUNNER_TEMP/release"
python -m build --wheel --outdir "$RUNNER_TEMP/release" packages/process-knowledge
python -m build --wheel --outdir "$RUNNER_TEMP/release" packages/wise-analytics
python -m venv "$RUNNER_TEMP/wheel-smoke-env"
"$RUNNER_TEMP/wheel-smoke-env/bin/python" -m pip install \
  'git+https://github.com/feelfine1977/wise-pm.git@v0.1.0' "$RUNNER_TEMP"/release/*.whl
REPO_ROOT="$PWD"
cd "$(mktemp -d)"
"$RUNNER_TEMP/wheel-smoke-env/bin/python" -I "$REPO_ROOT/apps/backend/tests/distribution/smoke_installed.py"
```

This dedicated script checks installed distribution origins and every supplied
static file's served bytes, both knowledge packs, templates and presets, and
migrations/API/SPA routes. It clears inherited `WISE_*` configuration and uses
a temporary synthetic workspace. The default profile is full; `--profile
minimal` checks an installation without analytics. The script does not install
anything. `--installed-target` is for the pip-target pytest fixture; omit it
when testing an ordinary wheel environment.


The minimal CI job can run the focused contracts with:

```bash
WISE_TEST_PROFILE=minimal python -m pytest -q tests/api/test_dependency_profiles.py tests/api/test_contract.py
```

Run from `apps/backend`. The full matrix can use `WISE_TEST_PROFILE=full
python -m pytest -q`. Local verification also runs the entire minimal suite,
including the golden scoring comparisons and wheel distribution fixture.
`tools/smoke_installed.py` is the actual-release CI smoke entry;
the helper under `tests/distribution/` is used by this package's synthetic
wheel test and can also be invoked independently as documented above.


The builder requires `--frontend-mode live`: an explicit caller declaration
that the supplied dist was built with mocks disabled (normally `npm run
build:live`). It records this declaration in the wheel and manifest; it does
not infer application behavior by scanning JavaScript. Index-only input is
not proof of a live build. CI must supply the dist from its live build job.
The builder requires root `THIRD_PARTY_NOTICES.md`, vendor
`wise-flow.provenance.json`, and the matching tarball. It verifies the tarball
SHA-256 and carries the root notices, flow provenance, flow licence/notices
and renderer licence files under `wise_workbench/distribution/`. It also
copies root LICENSE files into the staged build for setuptools licence
metadata. No frontend node_modules or sibling checkout is needed. The
synthetic fixture uses explicitly synthetic notice data; actual release
notices always come from the supplied vendored artifact.
