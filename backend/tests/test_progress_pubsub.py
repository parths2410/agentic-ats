import asyncio

import pytest

from app.pipeline import progress


@pytest.mark.asyncio
async def test_subscribe_and_publish_delivers_event():
    q = progress.subscribe("role-1")
    try:
        await progress.publish("role-1", {"type": "x"})
        out = await asyncio.wait_for(q.get(), timeout=0.5)
        assert out == {"type": "x"}
    finally:
        progress.unsubscribe("role-1", q)


@pytest.mark.asyncio
async def test_publish_to_role_with_no_subscribers_is_noop():
    await progress.publish("ghost", {"type": "x"})


@pytest.mark.asyncio
async def test_unsubscribe_idempotent():
    q = progress.subscribe("role-2")
    progress.unsubscribe("role-2", q)
    progress.unsubscribe("role-2", q)
    progress.unsubscribe("never-subscribed", q)


@pytest.mark.asyncio
async def test_publish_drops_oldest_when_full():
    q = progress.subscribe("role-3")
    try:
        # Fill the queue beyond its max with synchronous puts.
        for i in range(260):
            await progress.publish("role-3", {"i": i})
        # Latest must still be there.
        events: list[dict] = []
        try:
            while True:
                events.append(q.get_nowait())
        except asyncio.QueueEmpty:
            pass
        assert events[-1]["i"] == 259
    finally:
        progress.unsubscribe("role-3", q)


@pytest.mark.asyncio
async def test_multiple_subscribers_each_receive_event():
    q1 = progress.subscribe("role-4")
    q2 = progress.subscribe("role-4")
    try:
        await progress.publish("role-4", {"type": "p"})
        a = await asyncio.wait_for(q1.get(), timeout=0.5)
        b = await asyncio.wait_for(q2.get(), timeout=0.5)
        assert a == b == {"type": "p"}
    finally:
        progress.unsubscribe("role-4", q1)
        progress.unsubscribe("role-4", q2)
