"""ASGI entry point: ``uvicorn wise_workbench.main:app``."""

from wise_workbench.api.app import create_app

app = create_app()
