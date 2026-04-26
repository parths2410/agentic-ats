import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.llm import get_llm_provider
from app.llm.base import LLMProvider
from app.models.candidate import Candidate, CriterionScore
from app.models.criterion import Criterion
from app.schemas.candidate import (
    CandidateDetail,
    CandidateSummary,
    CriterionScoreRead,
    UploadResponse,
)
from app.services.resume_service import ResumeService, candidates_for_role
from app.services.role_service import RoleNotFound, RoleService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/roles/{role_id}/candidates", tags=["candidates"])


def _ensure_role(role_id: str, db: Session) -> None:
    try:
        RoleService(db).get(role_id)
    except RoleNotFound:
        raise HTTPException(status_code=404, detail="Role not found")


def _scores_for(db: Session, candidate_id: str) -> list[CriterionScoreRead]:
    rows = db.execute(
        select(CriterionScore, Criterion)
        .join(Criterion, Criterion.id == CriterionScore.criterion_id)
        .where(CriterionScore.candidate_id == candidate_id)
        .order_by(Criterion.order_index, Criterion.name)
    ).all()
    return [
        CriterionScoreRead(
            criterion_id=cs.criterion_id,
            criterion_name=cr.name,
            weight=cr.weight,
            score=cs.score,
            rationale=cs.rationale,
        )
        for cs, cr in rows
    ]


def _to_summary(db: Session, c: Candidate) -> CandidateSummary:
    return CandidateSummary(
        id=c.id,
        role_id=c.role_id,
        name=c.name,
        pdf_filename=c.pdf_filename,
        aggregate_score=c.aggregate_score,
        rank=c.rank,
        status=c.status,
        error_message=c.error_message,
        created_at=c.created_at,
        scores=_scores_for(db, c.id),
    )


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_candidates(
    role_id: str,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    llm: LLMProvider = Depends(get_llm_provider),
) -> UploadResponse:
    _ensure_role(role_id, db)

    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    payloads: list[tuple[str, bytes]] = []
    for f in files:
        if not (f.content_type or "").lower().startswith("application/pdf") and not (
            f.filename or ""
        ).lower().endswith(".pdf"):
            raise HTTPException(
                status_code=400,
                detail=f"{f.filename or 'file'}: only PDF uploads are supported.",
            )
        data = await f.read()
        if not data:
            raise HTTPException(status_code=400, detail=f"{f.filename}: empty file.")
        payloads.append((f.filename or "resume.pdf", data))

    service = ResumeService(db, llm)
    candidates = service.create_candidates(role_id, payloads)
    candidate_ids = [c.id for c in candidates]

    # Fire-and-forget: process in the background so the HTTP request returns
    # quickly. Progress is published over the role's WS channel.
    async def _run() -> None:
        bg_db = SessionLocal()
        try:
            bg_service = ResumeService(bg_db, llm)
            await bg_service.process_candidates_async(role_id, candidate_ids)
        except Exception:
            logger.exception("Background processing failed")
        finally:
            bg_db.close()

    asyncio.create_task(_run())

    return UploadResponse(
        candidates=[_to_summary(db, c) for c in candidates],
    )


@router.get("", response_model=list[CandidateSummary])
def list_candidates(role_id: str, db: Session = Depends(get_db)) -> list[CandidateSummary]:
    _ensure_role(role_id, db)
    return [_to_summary(db, c) for c in candidates_for_role(db, role_id)]


@router.get("/{candidate_id}", response_model=CandidateDetail)
def get_candidate(
    role_id: str, candidate_id: str, db: Session = Depends(get_db)
) -> CandidateDetail:
    _ensure_role(role_id, db)
    c = db.get(Candidate, candidate_id)
    if c is None or c.role_id != role_id:
        raise HTTPException(status_code=404, detail="Candidate not found")
    summary = _to_summary(db, c)
    return CandidateDetail(
        **summary.model_dump(),
        raw_text=c.raw_text or "",
        structured_profile=c.structured_profile,
        parse_confidence=c.parse_confidence,
    )


@router.get("/{candidate_id}/scores", response_model=list[CriterionScoreRead])
def get_candidate_scores(
    role_id: str, candidate_id: str, db: Session = Depends(get_db)
) -> list[CriterionScoreRead]:
    _ensure_role(role_id, db)
    c = db.get(Candidate, candidate_id)
    if c is None or c.role_id != role_id:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return _scores_for(db, candidate_id)


@router.delete("/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_candidate(role_id: str, candidate_id: str, db: Session = Depends(get_db)) -> None:
    _ensure_role(role_id, db)
    c = db.get(Candidate, candidate_id)
    if c is None or c.role_id != role_id:
        raise HTTPException(status_code=404, detail="Candidate not found")
    db.delete(c)
    db.commit()
