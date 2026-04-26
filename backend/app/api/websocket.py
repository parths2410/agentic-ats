import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.database import SessionLocal
from app.models.role import Role
from app.pipeline import progress

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws/roles/{role_id}/progress")
async def progress_ws(websocket: WebSocket, role_id: str) -> None:
    await websocket.accept()

    # Reject unknown roles up front so the client gets a clear failure.
    with SessionLocal() as db:
        if db.get(Role, role_id) is None:
            await websocket.send_json({"type": "error", "message": "Role not found"})
            await websocket.close()
            return

    queue = progress.subscribe(role_id)
    try:
        await websocket.send_json({"type": "ready", "role_id": role_id})
        while True:
            event = await queue.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("progress WS error")
    finally:
        progress.unsubscribe(role_id, queue)
