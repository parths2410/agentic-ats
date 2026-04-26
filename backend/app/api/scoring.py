import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.llm import get_llm_provider
from app.llm.base import LLMProvider
from app.services.resume_service import ResumeService
from app.services.role_service import RoleNotFound, RoleService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/roles/{role_id}/score", tags=["scoring"])


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def trigger_rescore(
    role_id: str,
    db: Session = Depends(get_db),
    llm: LLMProvider = Depends(get_llm_provider),
) -> dict:
    try:
        RoleService(db).get(role_id)
    except RoleNotFound:
        raise HTTPException(status_code=404, detail="Role not found")

    async def _run() -> None:
        bg_db = SessionLocal()
        try:
            await ResumeService(bg_db, llm).rescore_role(role_id)
        except Exception:
            logger.exception("Re-scoring failed")
        finally:
            bg_db.close()

    asyncio.create_task(_run())
    return {"status": "rescore_started"}
