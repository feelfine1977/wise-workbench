"""Record a tested wise-flow npm artifact and its exact source-file identities."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tarfile
from pathlib import Path


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--tarball', required=True, type=Path)
    args = parser.parse_args()
    source = args.source.resolve()
    tarball = args.tarball.resolve()
    source_package = json.loads((source / 'package.json').read_text())
    with tarfile.open(tarball) as archive:
        member = archive.extractfile('package/package.json')
        if member is None:
            parser.error('archive has no package/package.json')
        package = json.load(member)
        if package['name'] != '@wise/flow' or package['version'] != source_package['version']:
            parser.error('tarball name/version does not match the supplied flow source')
        names = set(archive.getnames())
        if not any(name.startswith('package/LICENSE') for name in names):
            parser.error('tarball must include its project licence')

    def git(*arguments: str) -> str:
        return subprocess.check_output(['git', '-C', str(source), *arguments], text=True)

    files = sorted(set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0')) - {''})
    identities = {name: digest(source / name) for name in files if (source / name).is_file()}
    encoded = json.dumps(identities, sort_keys=True, separators=(',', ':')).encode()
    root = Path(__file__).resolve().parents[1]
    vendor = root / 'vendor'
    vendor.mkdir(exist_ok=True)
    filename = f"wise-flow-{package['version']}.tgz"
    target = vendor / filename
    shutil.copyfile(tarball, target)
    provenance = {
        'package': package['name'], 'version': package['version'],
        'tarball': filename, 'sha256': digest(target),
        'source': {
            'repository': 'https://github.com/feelfine1977/wise-flow',
            'baseCommit': git('rev-parse', 'HEAD').strip(),
            'hasUncommittedChanges': bool(git('status', '--porcelain').strip()),
            'fileTreeSha256': hashlib.sha256(encoded).hexdigest(),
            'files': identities,
        },
    }
    (vendor / 'wise-flow.provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(f'Recorded {filename}; run npm install --package-lock-only in apps/frontend and verify a clean npm ci.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
