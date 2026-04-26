from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.chat import ChatHistory, ChatMessageRead
from app.services.chat_service import ChatService
from app.services.role_service import RoleNotFound, RoleService
from app.services.ui_state_service import UIStateService

router = APIRouter(prefix="/roles/{role_id}/chat", tags=["chat"])


def _ensure_role(role_id: str, db: Session) -> None:
    try:
        RoleService(db).get(role_id)
    except RoleNotFound:
        raise HTTPException(status_code=404, detail="Role not found")


@router.get("/history", response_model=ChatHistory)
def get_history(role_id: str, db: Session = Depends(get_db)) -> ChatHistory:
    _ensure_role(role_id, db)
    rows = ChatService(db, llm=_NoopLLM()).load_history(role_id)
    return ChatHistory(messages=[ChatMessageRead.model_validate(r) for r in rows])


@router.delete("/history", status_code=status.HTTP_204_NO_CONTENT)
def delete_history(role_id: str, db: Session = Depends(get_db)) -> None:
    _ensure_role(role_id, db)
    ChatService(db, llm=_NoopLLM()).clear_history(role_id)


@router.get("/ui-state")
def get_ui_state(role_id: str, db: Session = Depends(get_db)) -> dict:
    _ensure_role(role_id, db)
    svc = UIStateService(db)
    return svc.to_dict(svc.get_or_create(role_id))


@router.post("/reset")
def reset_ui(role_id: str, db: Session = Depends(get_db)) -> dict:
    _ensure_role(role_id, db)
    svc = UIStateService(db)
    return svc.to_dict(svc.reset(role_id))


# History endpoints don't actually need an LLM, but ChatService asks for one
# in its constructor. Use a tiny stand-in instead of forcing the API key check
# of the real provider for read-only operations.
class _NoopLLM:  # pragma: no cover — exercised indirectly
    async def chat(self, *_a, **_kw):
        raise NotImplementedError

    async def extract_criteria(self, _):
        return []

    async def parse_resume(self, _):
        return {}

    async def score_candidate(self, *_a):
        return {"scores": []}
