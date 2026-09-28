# Start here

Install from any directory using Python 3.12/3.13 and Node 24:

```bash
git clone https://github.com/feelfine1977/wise-workbench.git
cd wise-workbench
tools/install.sh --dev
apps/backend/.venv/bin/python tools/demo.py --workspace "$HOME/WISE Demo"
WISE_WORKSPACE="$HOME/WISE Demo" tools/start.sh
```

Open the **Demo** project. The public synthetic example has five cases; use it to learn the controls. It contains no private log and needs no reference workspace.

For your own analysis, use `WISE_WORKSPACE="/path/to/my-workspace" tools/start.sh` and create a project. Keep that folder outside the source repository. Reusing a folder opens its projects; choosing a new one starts empty.

## Follow the analysis

1. **Project:** open **Projects / new**, create a project and name the improvement question. Existing projects remain available there.
2. **Understand data:** choose a dataset, read its process guide, map columns and inspect data caveats. **Explore data** links categories, dates, recorded spans and case rows; **Flow types** shows observed behaviour.
3. **Process norm:** build constraints first, then organise them into business layers and weight the layers in each view. Use the data preview to calibrate a constraint. **Layers & views** exposes membership and weights; **Review** shows the actual missing owner/reason decisions before signature. Saved changes create new versions.
4. **Run WISE:** select a prepared dataset, norm version, one or more views, groupings and flow scope. This works without a previous run. Wait for scoring and analytics to finish.
5. **Analyse:** use process questions, ranked groups, flows and individual case evidence. Check support, coverage and logging limitations before accepting an explanation. Drag activities to improve map layout; **Reset layout** restores automatic positions. The generated BPMN model is an interpretation of the log, not a verified executable business model.
6. **Improve:** record and test a finding or hypothesis, then propose an action with an owner. Freeze relevant evidence and add reasoning to the notebook.

The coloured **view bookmarks** appear where stakeholder priorities apply, including layer weighting and assessed results. They do not change the dataset or the meaning of an individual constraint. **Layers in each view** opens the definitions behind that perspective.

See the [full user guide](USER_GUIDE.md) for screen details. Read [current limitations](../README.md#current-limits) before interpreting the results; older walkthroughs and screenshots are historical observations, not acceptance claims for every dataset.

## Starting and stopping

- `tools/start.sh --no-build` reuses a built frontend.
- `tools/start.sh --no-build --port 8002` chooses another port. Do not use `--port:8002`.
- Ctrl-C stops the foreground server. An occupied-port message identifies an existing listener; do not repeatedly rebuild to resolve it.
- The Vite large-chunk warning does not prevent a successful build.

After changing backend code, restart the server; rebuilding the frontend alone does not reload Python. Development and artifact installation are described in [DEPLOY.md](DEPLOY.md).
