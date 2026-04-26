"""In-memory pub/sub for resume processing progress, keyed by role_id.

Used by:
- ResumeService → publish progress events as parsing/scoring stages run
- WebSocket endpoint → subscribe per-role and forward events to the client

Single-process, single-user assumed (NF-10).
"""

from __future__ import annotations

import asyncio
from typing import Any

_subscribers: dict[str, set[asyncio.Queue]] = {}


def subscribe(role_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    _subscribers.setdefault(role_id, set()).add(q)
    return q


def unsubscribe(role_id: str, q: asyncio.Queue) -> None:
    queues = _subscribers.get(role_id)
    if queues is None:
        return
    queues.discard(q)
    if not queues:
        _subscribers.pop(role_id, None)


async def publish(role_id: str, event: dict[str, Any]) -> None:
    queues = list(_subscribers.get(role_id, ()))
    for q in queues:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            # Drop oldest, enqueue newest. Progress is "last-write-wins" for
            # any single candidate stage; falling behind is fine.
            try:
                q.get_nowait()
            except asyncio.QueueEmpty:
                pass
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass
