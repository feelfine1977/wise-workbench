"""Exercise installed product artifacts; run with python -I outside editable installs."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path


def main() -> None:
    for key in tuple(os.environ):
        if key.startswith("WISE_"):
            del os.environ[key]
    import wise
    import wise_knowledge
    import wise_workbench
    from fastapi.testclient import TestClient
    from wise_knowledge.paths import knowledge_root
    from wise_workbench.api.app import create_app
    from wise_workbench.settings import Settings

    repository = Path(__file__).resolve().parents[1]
    for module in (wise, wise_knowledge, wise_workbench):
        assert not Path(module.__file__).resolve().is_relative_to(repository), f'{module.__name__} is loaded from the checkout'
    root = knowledge_root()
    assert not root.is_relative_to(repository), 'knowledge content is loaded from the checkout'
    for pack in ('p2p', 'o2c'):
        assert (root / pack / 'guidance.yaml').is_file(), f'{pack} guidance missing'
    assert (root / 'schema' / 'ontology.schema.json').is_file()
    with tempfile.TemporaryDirectory(prefix='wise-installed-smoke-') as directory:
        settings = Settings(workspace=Path(directory), inprocess_worker=False)
        static = settings.resolved_static_dir
        assert static and not static.is_relative_to(repository), 'no packaged frontend found'
        with TestClient(create_app(settings)) as client:
            for path in ('/', '/p/demo/runs/demo/flow', '/api/v1/system/health', '/docs'):
                response = client.get(path)
                assert response.status_code == 200, (path, response.text[:200])
            html = client.get('/').text
            assert '/assets/' in html
    print(json.dumps({'classic': wise.__version__, 'knowledge': str(root), 'frontend': str(static), 'installedSmoke': 'passed'}))


if __name__ == '__main__':
    main()
