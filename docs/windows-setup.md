# Start WISE Workbench on Windows

This guide uses **PowerShell 7**, a source checkout, Python **3.13** (3.12 also matches CI), and **Node 24**. It builds the live frontend and serves the application locally at `http://127.0.0.1:8000/`.

**Validation status:** the commands have been checked against this repository's installer, package metadata, CLI and CI configuration. They have **not been executed on Windows**. [CI](../.github/workflows/ci.yml) currently runs on Ubuntu, not Windows. Native Windows installation, dependency wheels, file handling and browser behavior still require a Windows smoke test.

## 1. Install prerequisites

Install these, then open a new PowerShell terminal:

- [Git for Windows](https://git-scm.com/downloads/win), available from the command line.
- [Python for Windows](https://www.python.org/downloads/windows/): choose a normal 64-bit **3.13** or **3.12** installation with the `py` launcher. Do not substitute a newer major/minor or a free-threaded build for this setup.
- [Node.js](https://nodejs.org/en/download): choose **24.x**, including npm. `.nvmrc` and the frontend CI job select 24, even though `package.json` permits a wider range.
- [PowerShell 7](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows).

Check the commands before continuing:

```powershell
$PSVersionTable.PSVersion
Get-Command git, py, node, npm.cmd
git --version
py -3.13 --version
node --version
npm.cmd --version
```

If you installed Python 3.12, replace `py -3.13` with `py -3.12` below. Use `npm.cmd` explicitly; the examples do not require running `npm.ps1` or changing PowerShell's execution policy. The venv's Python is called directly, so activation is unnecessary. See the official [Python launcher](https://docs.python.org/3.13/using/windows.html#python-launcher-for-windows) and [venv documentation](https://docs.python.org/3.13/library/venv.html).

## 2. Choose the Workbench revision and clone it

For the current development checkpoint discussed in this guide, use `checkpoint/workbench-2026-09-27`. To use the repository's default/release line instead, change `$WorkbenchRef` to `main` **before cloning**. A published release tag can also be supplied when its exact name is known. `main`, a release tag and the checkpoint may have different features; do not assume that they contain the same fixes.

A fresh clone gets **pushed commits only**. Changes still present only on another machine, including these instructions before they are pushed, are not transferred by cloning. If Git cannot find the checkpoint branch, confirm that it has been pushed; do not silently substitute another revision.

```powershell
$WorkbenchRef = 'checkpoint/workbench-2026-09-27'
$WorkbenchRepo = Join-Path $env:USERPROFILE 'source\wise-workbench'
New-Item -ItemType Directory -Force (Split-Path $WorkbenchRepo) | Out-Null

git clone --branch $WorkbenchRef https://github.com/feelfine1977/wise-workbench.git $WorkbenchRepo
if ($LASTEXITCODE -ne 0) { throw 'Clone failed; check the branch and repository access.' }
Set-Location $WorkbenchRepo
git branch --show-current
git rev-parse HEAD
```

The destination must be a new checkout directory. For an existing checkout, use the update instructions below. HTTPS avoids requiring an SSH key; Git may still request authentication if your access requires it. Keep credentials out of commands and source files.

## 3. Install Python packages with an explicit core profile

The method package is named **`wise-pm`** and imports as **`wise`**. “Core” is a profile description; do not install an unrelated package named `wise` or `wise-core`.

| Core profile | Pinned `wise-pm` source | Python environment |
| --- | --- | --- |
| `classic` — default | Commit `df5db50b839cc124b489a269894f5a2bfe7dc634`, repository root | `apps/backend/.venv` |
| `next` — explicit development candidate | Commit `9c5e6db807ece6f2fe02857082dfd8cd87bf019c`, subdirectory `packages/wise-pm` | `apps/backend/.venv-next` |

The Workbench branch and method profile are separate choices. The checkpoint can use classic. Select `next` only when you intend to use the pinned candidate; keep its workspace separate. Both profiles can report package version `0.1.0`, so that version alone cannot identify the installed commit. See [core profiles](CORE_PROFILES.md).

Run this from the checkout root. Change only `$WiseCore` if you need the candidate. The profile tool, when present, supplies the pin from the selected checkout; the classic fallback also supports older `main` checkouts without that tool.

```powershell
$WiseCore = 'classic'
$WiseVenv = 'apps\backend\.venv'
if ($WiseCore -eq 'next') {
    $WiseVenv = 'apps\backend\.venv-next'
} elseif ($WiseCore -ne 'classic') {
    throw 'Choose classic or next.'
}

py -3.13 -m venv $WiseVenv
if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed.' }
$WisePython = Join-Path $WorkbenchRepo "$WiseVenv\Scripts\python.exe"
& $WisePython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'pip setup failed.' }

$WiseProfileTool = Join-Path $WorkbenchRepo 'tools\check-core-profile.py'
if (Test-Path -LiteralPath $WiseProfileTool) {
    $WiseCoreRequirement = & $WisePython $WiseProfileTool --core $WiseCore --requirement
    if ($LASTEXITCODE -ne 0) { throw 'Core requirement lookup failed.' }
} elseif ($WiseCore -eq 'classic') {
    $WiseCoreRequirement = 'wise-pm @ git+https://github.com/feelfine1977/wise-pm.git@df5db50b839cc124b489a269894f5a2bfe7dc634'
} else {
    throw 'This checkout does not provide the next profile; use the checkpoint or classic.'
}

Write-Output $WiseCoreRequirement
& $WisePython -m pip install --force-reinstall "$WiseCoreRequirement"
if ($LASTEXITCODE -ne 0) { throw 'Pinned core installation failed.' }
& $WisePython -m pip install -e './packages/process-knowledge' -e './packages/wise-analytics' -e './apps/backend[full]'
if ($LASTEXITCODE -ne 0) { throw 'Workbench package installation failed.' }
& $WisePython -m pip check
if ($LASTEXITCODE -ne 0) { throw 'Python dependency conflicts need resolving before startup.' }
& $WisePython -c "import wise, wise_knowledge, wise_analytics, wise_workbench; print('Workbench imports OK')"
if ($LASTEXITCODE -ne 0) { throw 'A runtime package could not be imported.' }
if (Test-Path -LiteralPath $WiseProfileTool) {
    & $WisePython $WiseProfileTool --core $WiseCore
    if ($LASTEXITCODE -ne 0) { throw 'Installed core does not match the selected profile.' }
}
```

This installs dependencies normally, including those of the pinned core. The **full product profile** includes local `wise-knowledge`, local `wise-analytics` and the backend's `[full]` extra. The backend includes XES support through `pm4py`; `[xes]` is not needed. A minimal API environment without analytics is a different profile and is not the setup above.

For development/test tools, use `[dev]` on the two local packages and `[dev,full]` on the backend in that same install command. Optional analytics extras `[stats,subgroups,parallel]` add SciPy, scikit-learn and joblib respectively; they are not required by this basic startup profile. PostgreSQL and DOCX extras are also optional. Neither selecting `next` nor installing extras enables unimplemented Workbench features.

The frontend has a committed npm lockfile. Python dependencies use version ranges plus an explicit method commit; there is no complete Python dependency lock. Do not describe two installations as identical solely because the core pin matches. pip supports the candidate's `#subdirectory=packages/wise-pm` URL through its documented [VCS requirement syntax](https://pip.pypa.io/en/stable/topics/vcs-support/).

## 4. Build the live frontend

Keep the full repository layout: npm installs the packaged flow renderer from `vendor/wise-flow-0.3.5.tgz` in this checkpoint. No sibling `wise-flow` checkout is required. Use the artifact referenced by your selected revision's lockfile, not a manually downloaded replacement.

```powershell
Set-Location (Join-Path $WorkbenchRepo 'apps\frontend')
$env:VITE_USE_MOCKS = '0'
Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Locked frontend dependency installation failed.' }
npm.cmd run build:live
if ($LASTEXITCODE -ne 0) { throw 'Live frontend build failed; do not start with an older build.' }
Set-Location $WorkbenchRepo
$WiseStaticDir = Join-Path $WorkbenchRepo 'apps\frontend\dist'
if (-not (Test-Path -LiteralPath (Join-Path $WiseStaticDir 'index.html'))) {
    throw 'The live frontend index.html is missing.'
}
```

[`npm ci`](https://docs.npmjs.com/cli/v11/commands/npm-ci/) uses the lockfile and refuses inconsistent package metadata. The build runs the design-token prerequisite automatically. Do not use `--omit=dev`: the frontend build needs its development tools. Leave `NODE_ENV` unset while installing if your shell normally forces `production`.

The live build calls `/api/v1` on the same origin as the page. Clear any conflicting `VITE_API_URL` or `VITE_USE_MOCKS` entries in your own uncommitted `.env.local`/`.env.live.local` files before building. Do not use `build:demo` for your own data. A Vite large-chunk warning alone does not mean the build failed; check its exit code and output files.

## 5. Choose a workspace and start

Use a persistent local directory **outside the checkout**, preferably outside cloud-synchronized/network folders. This is where the database, uploaded files, prepared data, norm versions and run artifacts live. Reusing its exact path opens the existing projects; a new path starts empty.

```powershell
$env:WISE_WORKSPACE = Join-Path $env:USERPROFILE "WISE Workbench Windows-$WiseCore"
$env:WISE_HOST = '127.0.0.1'
$env:WISE_PORT = '8000'
$env:WISE_INPROCESS_WORKER = '1'
$env:WISE_LOG_FORMAT = 'console'
$env:WISE_LOG_LEVEL = 'INFO'
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

# This guide uses SQLite in the chosen workspace, not a database from an older session.
Remove-Item Env:WISE_DATABASE_URL -ErrorAction SilentlyContinue

$WiseLogDir = Join-Path $env:LOCALAPPDATA 'WISE\logs'
New-Item -ItemType Directory -Force $WiseLogDir | Out-Null
$WiseLogFile = Join-Path $WiseLogDir ("workbench-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
git rev-parse HEAD | Set-Content (Join-Path $WiseLogDir 'workbench-commit.txt')
& $WisePython -m pip freeze | Set-Content (Join-Path $WiseLogDir 'python-packages.txt')

& $WisePython -u -m wise_workbench.cli serve --host 127.0.0.1 --port $env:WISE_PORT --static $WiseStaticDir --open 2>&1 | Tee-Object -FilePath $WiseLogFile
```

The server stays in the foreground. Its startup line should identify the **application**, built frontend and intended workspace. It opens a browser after the health endpoint responds; otherwise open `http://127.0.0.1:8000/` yourself. In another terminal, verify the API with:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/api/v1/system/health'
```

The service creates the workspace and applies database migrations on startup. The in-process worker handles jobs; do not add `--no-worker` for basic use. Interactive API documentation is at `http://127.0.0.1:8000/docs`.

PowerShell uses `$env:NAME = 'value'`; Bash's `NAME=value command` syntax does not apply. The `&` invokes the executable stored in `$WisePython`, including paths with spaces. These environment settings affect this terminal and its child processes, not every future terminal. See [environment variables](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables) and the [call operator](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_operators#call-operator-).

## 6. Import data or try the small public example

For your own work, create a project, upload a local CSV/XES log through **Data**, review the column mapping and prepare the case table. Define or import a norm, then run the assessment. See the [user guide](USER_GUIDE.md). Files named in source-machine notes or private workspaces are not downloaded by cloning this repository.

For a public five-case demonstration, stop the server and choose a **new or empty** workspace. From the checkout root with `$WisePython` still set:

```powershell
$env:WISE_WORKSPACE = Join-Path $env:USERPROFILE "WISE Demo Windows-$WiseCore"
& $WisePython .\tools\demo.py --workspace $env:WISE_WORKSPACE
if ($LASTEXITCODE -ne 0) { throw 'Demo creation failed; do not overwrite an existing analysis.' }
```

Then repeat the server command from step 5 without resetting `WISE_WORKSPACE`. Open the **Demo** project. These generated cases teach the controls; they are not observations from real users or a meaningful business ranking. The demo refuses a nonempty directory and should not be rerun to reopen it.

An optional BPIC2019 preset needs an existing local dataset file. Set its actual path in the server terminal **before starting/restarting**; for example:

```powershell
$WiseDatasetFile = Join-Path $env:USERPROFILE 'WISE Data\BPI_Challenge_2019.csv'
if (-not (Test-Path -LiteralPath $WiseDatasetFile)) { throw 'Put the dataset at this path or set its actual location.' }
$env:WISE_BPIC19_CSV = $WiseDatasetFile
```

The public norm template is packaged with knowledge; the event log is not. Uploading through the UI copies the source into the workspace. CLI/local-path ingestion can retain an absolute source path instead; keep that original file available for subsequent jobs.

## 7. Stop, restart, back up and update

**Stop:** press Ctrl-C in the server terminal and wait for shutdown. Closing a browser tab does not stop Python. Logs are in `$WiseLogDir`; review private labels, paths and other sensitive contents before sharing them.

**Restart in the same terminal:** repeat the last `serve` command, optionally generating a new `$WiseLogFile`. No rebuild or demo creation is needed. For a fresh terminal, restore the paths and environment first; this example reopens the classic workspace above:

```powershell
$WorkbenchRepo = Join-Path $env:USERPROFILE 'source\wise-workbench'
$WisePython = Join-Path $WorkbenchRepo 'apps\backend\.venv\Scripts\python.exe'
$WiseStaticDir = Join-Path $WorkbenchRepo 'apps\frontend\dist'
$env:WISE_WORKSPACE = Join-Path $env:USERPROFILE 'WISE Workbench Windows-classic'
$env:WISE_INPROCESS_WORKER = '1'
$env:WISE_LOG_FORMAT = 'console'
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
Set-Location $WorkbenchRepo
& $WisePython -u -m wise_workbench.cli serve --host 127.0.0.1 --port 8000 --static $WiseStaticDir --open
```

Use your **actual existing workspace**, including the demo path if that is what you used. For `next`, select `.venv-next\Scripts\python.exe` and its corresponding workspace. Restore any deliberate dataset/database overrides. The fresh-terminal example shows logs in the console; use `Tee-Object` as in step 5 to keep a file.

**Back up before upgrades:** stop the server and any separate worker, then copy the **whole workspace**, including `workbench.db`, any SQLite sidecar files and `projects/`. Restore metadata and artifacts together. Keep backups outside Git. Do not run two separate Workbench instances against the same workspace for basic local use.

**Moving a macOS/Linux workspace to Windows is not validated.** A folder copy does not translate recorded absolute source paths. Keep the original workspace intact, use a backup copy for migration experiments, and retain original source files. Starting a fresh Windows workspace and importing the data does not transfer historical decisions or run artifacts.

**Update an existing checkout:** stop the server, back up the workspace, then:

```powershell
Set-Location $WorkbenchRepo
git status --short
git branch --show-current
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'Update refused; resolve the branch or local changes before continuing.' }
```

Inspect local changes before pulling; do not discard them to make an update succeed. Re-run the dependency installation and live-build steps for the chosen revision, then restart Python. Changing branches/profiles should use a separate environment/workspace or a backed-up copy. Virtual environments and `node_modules` must be installed for Windows, not copied from another OS.

## Troubleshooting and offline limits

| Symptom | Check |
| --- | --- |
| `py -3.13` is unavailable | Install 3.13 with its launcher or consistently use installed 3.12. Check `Get-Command py`. |
| `npm.ps1` is blocked | Use `npm.cmd` as shown. Venv activation is not required either. |
| `git` is missing during pip installation | Install Git for Windows, reopen the terminal and run `git --version`. The core is installed from a pinned Git commit. |
| Wrong core or `No module named wise` | Use the intended venv's Python; repeat the pinned installation and profile verification. Do not replace it with a similarly named PyPI package. |
| Native wheel/build failure | Record the failing package, Python version and architecture. Windows wheels/compiler requirements have not been validated here; do not bypass the dependency or claim the application is fully installed. |
| `/docs` works, but the application does not | Confirm the live build succeeded and `--static` points to the directory containing `index.html`. A plain backend install alone does not supply this checkout's frontend. |
| Fixture data appears | Check `VITE_USE_MOCKS`, local Vite environment files and the actual served dist; rebuild with `build:live`. |
| Port 8000 is occupied | Stop the Workbench instance you own, or use `--port 8002` and open that port. `netstat.exe -ano` can identify listeners. Do not terminate an unidentified process. |
| Projects seem missing | Check the startup workspace path and `WISE_DATABASE_URL`. Do not initialize a new demo over an existing workspace. |
| Jobs remain queued | Keep the server running with the in-process worker enabled; inspect the terminal/log and job error. |

Initial Git, pip and npm installation needs network access. A built local application and installed dependencies can be used with local data without downloading reference logs; a fully air-gapped installation bundle is not supplied by this guide. Public documentation links and any deliberate downloads still need a connection.

Keep workspaces, logs, backups, private CSV/XES files, installation receipts and credentials outside the source repository. Cloning/pushing source does not synchronize them; `.gitignore` is not a general guarantee that every private file will be ignored. Keep the server on `127.0.0.1`: Workbench currently has no login or multi-user access boundary.
