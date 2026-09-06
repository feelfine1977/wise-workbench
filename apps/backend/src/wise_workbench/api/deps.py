"""Request-scoped access to the container."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from wise_workbench.container import Container


def get_container(request: Request) -> Container:
    return request.app.state.container  # type: ignore[no-any-return]


ContainerDep = Annotated[Container, Depends(get_container)]
