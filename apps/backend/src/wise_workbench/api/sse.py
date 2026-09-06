"""Server-sent events for job progress.

The event iterator is synchronous (it polls the job table); it runs on a
worker thread and is pumped into the response. Heartbeat comments keep
proxies from closing an idle stream, and a disconnected client stops the
pump on the next event or heartbeat.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Iterator
from typing import Any

from fastapi import Request
from fastapi.responses import StreamingResponse

RETRY_MS = 2000


def format_event(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


async def _pump(events: Iterator[tuple[str, dict[str, Any]]], request: Request | None) -> AsyncIterator[str]:
    loop = asyncio.get_running_loop()
    sentinel = object()

    def next_event() -> Any:
        try:
            return next(events)
        except StopIteration:
            return sentinel

    yield f"retry: {RETRY_MS}\n\n"
    try:
        while True:
            if request is not None and await request.is_disconnected():
                return
            item = await loop.run_in_executor(None, next_event)
            if item is sentinel:
                return
            event, data = item
            if event == "heartbeat":
                yield ": heartbeat\n\n"
                continue
            yield format_event(event, data)
    finally:
        close = getattr(events, "close", None)
        if callable(close):
            close()


def sse_response(events: Iterator[tuple[str, dict[str, Any]]], request: Request | None = None) -> StreamingResponse:
    return StreamingResponse(
        _pump(events, request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
