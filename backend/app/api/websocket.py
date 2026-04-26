import asyncio
import logging

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.database import SessionLocal
from app.llm import get_llm_provider
from app.llm.base import LLMProvider
from app.models.role import Role
from app.pipeline import progress
from app.services.chat_service import ChatService, RoleNotFound

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


# ---- Chat WebSocket --------------------------------------------------------


def _resolve_llm() -> LLMProvider:
    """Resolve the LLM provider, raising HTTPException → translated below."""
    return get_llm_provider()


@router.websocket("/ws/roles/{role_id}/chat")
async def chat_ws(websocket: WebSocket, role_id: str) -> None:
    await websocket.accept()

    with SessionLocal() as db:
        if db.get(Role, role_id) is None:
            await websocket.send_json({"type": "error", "message": "Role not found"})
            await websocket.close()
            return

    try:
        try:
            llm = _resolve_llm()
        except Exception as e:
            await websocket.send_json({"type": "error", "message": f"LLM unavailable: {e}"})
            await websocket.close()
            return

        await websocket.send_json({"type": "ready", "role_id": role_id})

        while True:
            payload = await websocket.receive_json()
            if payload.get("type") != "chat_message":
                # Tolerate unknown message types — just ignore them.
                continue
            user_message = str(payload.get("content") or "").strip()
            if not user_message:
                await websocket.send_json({
                    "type": "error",
                    "message": "Empty message ignored",
                })
                continue

            await _handle_chat_turn(websocket, role_id, user_message, llm)

    except WebSocketDisconnect:
        return
    except Exception:
        logger.exception("chat WS error")


async def _handle_chat_turn(
    websocket: WebSocket,
    role_id: str,
    user_message: str,
    llm: LLMProvider,
) -> None:
    db = SessionLocal()
    try:
        svc = ChatService(db, llm)

        async def on_status(evt: dict) -> None:
            await websocket.send_json(evt)

        try:
            result = await svc.handle_message(role_id, user_message, on_tool_status=on_status)
        except RoleNotFound:
            await websocket.send_json({"type": "error", "message": "Role not found"})
            return
        except Exception as e:
            logger.exception("Chat turn failed")
            await websocket.send_json({
                "type": "error",
                "message": f"Chat failed: {e}",
            })
            return

        await websocket.send_json({
            "type": "chat_complete",
            "content": result.text,
            "ui_mutations": result.ui_mutations,
            "iterations": result.iterations,
            "truncated": result.truncated,
        })
    finally:
        db.close()
