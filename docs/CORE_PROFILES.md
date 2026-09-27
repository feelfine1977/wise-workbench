# Core development profiles

Classic remains the default for installation and `tools/start.sh`. The explicit
`next` profile is a pinned development/CI candidate for the existing Workbench
behavior. It does not enable optional actionability or other extension capabilities.

| Profile | `wise-pm` Git commit | Package subdirectory | Environment |
| --- | --- | --- | --- |
| `classic` (default) | `df5db50b839cc124b489a269894f5a2bfe7dc634` | repository root | `apps/backend/.venv` |
| `next` | `9c5e6db807ece6f2fe02857082dfd8cd87bf019c` | `packages/wise-pm` | `apps/backend/.venv-next` |

From the checkout root, with Python 3.12 or 3.13 and Node 24 available:

```sh
tools/install.sh --dev                       # classic; --core classic is equivalent
tools/install.sh --dev --core next           # separate candidate environment
apps/backend/.venv-next/bin/python tools/check-core-profile.py --core next
```

Set `WISE_BOOTSTRAP_PYTHON=python3.13` on the install command if the default
`python3` is not supported. Both profiles install the local analytics and knowledge
packages and locked frontend dependencies; `--dev` adds development dependencies.
Installing `next` leaves the classic Python environment and startup default intact.

Start the candidate with an explicit interpreter and a new, separate workspace:

```sh
next_workspace="$(mktemp -d "${TMPDIR:-/tmp}/wise-next-workspace.XXXXXX")"
WISE_PYTHON="$PWD/apps/backend/.venv-next/bin/python" \
  WISE_WORKSPACE="$next_workspace" tools/start.sh --port 8010
```

This creates an empty workspace; import the data you choose through the application.
Use a separate persistent directory instead if you need to retain the analysis.
Run `tools/start.sh` without these overrides to use classic again.

`tools/check-core-profile.py` verifies `wise-pm`'s `direct_url.json` repository,
resolved commit, requested revision and subdirectory, then actually imports `wise`
and checks its file against the installed distribution. A shared version number
such as `0.1.0` is not evidence of the selected profile. Missing provenance,
editable/local installs and shadowed module paths fail verification. The installer
reinstalls the pinned core even when its version matches an existing installation.

CI keeps the classic jobs and adds `backend-next` on Python 3.12 and 3.13. It installs
the actual pinned candidate and both local packages with development dependencies,
requires successful imports and provenance verification, then runs the full backend,
analytics and knowledge suites in their respective directories plus OpenAPI drift.
Core profile parsing and provenance failures are tested offline with:

```sh
python3 -m unittest discover -s tests/tooling -v
```
