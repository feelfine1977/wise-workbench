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

1. **Data:** state the business question, choose the case notion, map columns, inspect flow types and resolve material data caveats.
2. **Norm:** review the expectations and applicability with the process owner. Save each changed expectation with its reason and owner, reload to inspect the saved decision, then mark it reviewed and approve it under the responsible person's name. The numbers preview the selected norm version and data, even before a run. Use **Rename norm** for its name and **the rule → Expectation name** for an individual label. A missing required field is highlighted and focused; a refusal keeps the inputs so it can be corrected.
3. **Run:** choose perspective, grouping, scope and minimum group size. Wait for scoring and analytics to finish.
4. **Signals:** read a group's priority alongside its case count, confidence and caveats. Start with a plausible, well-supported group.
5. **Flow / Board:** click an activity or context value, apply a filter and check the count and chips. **Model** draws a BPMN representation of the log; it is not a verified executable business model.
6. **Why?:** inspect drivers, comparisons, cases and data-trust gates. Check whether a shortfall reflects process behaviour or logging limitations.
7. **What can we do?:** record a finding or hypothesis, test it, and propose an action with an owner. Freeze relevant screens and add reasoning to the notebook.

See the [full user guide](USER_GUIDE.md) for screen details. Read [current limitations](../README.md#current-limits) before interpreting the results; older walkthroughs and screenshots are historical observations, not acceptance claims for every dataset.

## Starting and stopping

- `tools/start.sh --no-build` reuses a built frontend.
- `tools/start.sh --no-build --port 8002` chooses another port. Do not use `--port:8002`.
- Ctrl-C stops the foreground server. An occupied-port message identifies an existing listener; do not repeatedly rebuild to resolve it.
- The Vite large-chunk warning does not prevent a successful build.

After changing backend code, restart the server; rebuilding the frontend alone does not reload Python. Development and artifact installation are described in [DEPLOY.md](DEPLOY.md).
