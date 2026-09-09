"""Create and score the public five-case example in a new, isolated workspace."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True)
    args = parser.parse_args()
    workspace = args.workspace.expanduser().resolve()
    if workspace.exists() and (not workspace.is_dir() or any(workspace.iterdir())):
        parser.error('choose a new or empty workspace; this command never replaces an existing analysis')

    import wise
    from wise_workbench.cli import main as cli

    inputs = workspace / 'demo-inputs'
    inputs.mkdir(parents=True)
    events = inputs / 'events.csv'
    norm = inputs / 'norm.json'
    wise.running_p2p_events().to_csv(events, index=False)
    norm.write_text(json.dumps(wise.running_p2p_norm().to_dict(), indent=2) + '\n', encoding='utf-8')
    common = ['--workspace', str(workspace)]
    result = cli(common + ['demo', 'ingest', '--csv', str(events), '--case', 'case', '--activity', 'activity', '--timestamp', 'time', '--attr', 'company', '--attr', 'vendor', '--attr', 'flow_type'])
    if result:
        return result
    result = cli(common + ['demo', 'run', '--norm', str(norm), '--slicing', 'company', '--gamma', '0', '--min-cases', '1'])
    if not result:
        print(f'\nDemo ready in {workspace}. Open the Demo project. These five cases demonstrate controls, not a business ranking.')
    return result


if __name__ == '__main__':
    raise SystemExit(main())
