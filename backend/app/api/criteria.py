from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.llm import get_llm_provider
from app.llm.anthropic_provider import LLMResponseError
from app.llm.base import LLMProvider
from app.models.criterion import Criterion
from app.schemas.criterion import (
    CriteriaExtractionResponse,
    CriterionCreate,
    CriterionRead,
    CriterionUpdate,
)
from app.services.role_service import RoleNotFound, RoleService, mark_role_scores_stale

router = APIRouter(prefix="/roles/{role_id}/criteria", tags=["criteria"])


def _ensure_role(role_id: str, db: Session) -> None:
    try:
        RoleService(db).get(role_id)
    except RoleNotFound:
        raise HTTPException(status_code=404, detail="Role not found")


def _next_order_index(role_id: str, db: Session) -> int:
    current_max = db.execute(
        select(func.max(Criterion.order_index)).where(Criterion.role_id == role_id)
    ).scalar()
    return (current_max or 0) + 1


@router.post("/extract", response_model=CriteriaExtractionResponse)
async def extract_criteria(
    role_id: str,
    db: Session = Depends(get_db),
    llm: LLMProvider = Depends(get_llm_provider),
) -> CriteriaExtractionResponse:
    try:
        role = RoleService(db).get(role_id)
    except RoleNotFound:
        raise HTTPException(status_code=404, detail="Role not found")

    if not role.job_description.strip():
        raise HTTPException(
            status_code=400,
            detail="Role has no job description. Save a JD before extracting criteria.",
        )

    try:
        proposals = await llm.extract_criteria(role.job_description)
    except LLMResponseError as e:
        raise HTTPException(status_code=502, detail=f"LLM response error: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM request failed: {e}")

    return CriteriaExtractionResponse(proposals=proposals)


@router.get("", response_model=list[CriterionRead])
def list_criteria(role_id: str, db: Session = Depends(get_db)) -> list[CriterionRead]:
    _ensure_role(role_id, db)
    rows = db.execute(
        select(Criterion)
        .where(Criterion.role_id == role_id)
        .order_by(Criterion.order_index, Criterion.name)
    ).scalars().all()
    return [CriterionRead.model_validate(c) for c in rows]


@router.post("", response_model=CriterionRead, status_code=status.HTTP_201_CREATED)
def create_criterion(
    role_id: str,
    payload: CriterionCreate,
    db: Session = Depends(get_db),
) -> CriterionRead:
    _ensure_role(role_id, db)
    criterion = Criterion(
        role_id=role_id,
        name=payload.name.strip(),
        description=payload.description,
        weight=payload.weight,
        source=payload.source,
        order_index=payload.order_index
        if payload.order_index is not None
        else _next_order_index(role_id, db),
    )
    db.add(criterion)
    db.commit()
    db.refresh(criterion)
    mark_role_scores_stale(db, role_id)
    return CriterionRead.model_validate(criterion)


@router.put("/{criterion_id}", response_model=CriterionRead)
def update_criterion(
    role_id: str,
    criterion_id: str,
    payload: CriterionUpdate,
    db: Session = Depends(get_db),
) -> CriterionRead:
    _ensure_role(role_id, db)
    criterion = db.get(Criterion, criterion_id)
    if criterion is None or criterion.role_id != role_id:
        raise HTTPException(status_code=404, detail="Criterion not found")

    if payload.name is not None:
        criterion.name = payload.name.strip()
    if payload.description is not None:
        criterion.description = payload.description
    if payload.weight is not None:
        criterion.weight = payload.weight
    if payload.order_index is not None:
        criterion.order_index = payload.order_index

    db.commit()
    db.refresh(criterion)
    mark_role_scores_stale(db, role_id)
    return CriterionRead.model_validate(criterion)


@router.delete("/{criterion_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_criterion(
    role_id: str,
    criterion_id: str,
    db: Session = Depends(get_db),
) -> None:
    _ensure_role(role_id, db)
    criterion = db.get(Criterion, criterion_id)
    if criterion is None or criterion.role_id != role_id:
        raise HTTPException(status_code=404, detail="Criterion not found")
    db.delete(criterion)
    db.commit()
    mark_role_scores_stale(db, role_id)
