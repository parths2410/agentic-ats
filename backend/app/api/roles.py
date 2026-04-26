from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.role import RoleCreate, RoleRead, RoleSummary, RoleUpdate
from app.services.role_service import RoleNotFound, RoleService

router = APIRouter(prefix="/roles", tags=["roles"])


@router.post("", response_model=RoleRead, status_code=status.HTTP_201_CREATED)
def create_role(payload: RoleCreate, db: Session = Depends(get_db)) -> RoleRead:
    role = RoleService(db).create(payload)
    return RoleRead.model_validate(role)


@router.get("", response_model=list[RoleSummary])
def list_roles(db: Session = Depends(get_db)) -> list[RoleSummary]:
    rows = RoleService(db).list_with_counts()
    return [
        RoleSummary(
            id=role.id,
            title=role.title,
            created_at=role.created_at,
            updated_at=role.updated_at,
            candidate_count=cand_count,
            criteria_count=crit_count,
        )
        for role, cand_count, crit_count in rows
    ]


@router.get("/{role_id}", response_model=RoleRead)
def get_role(role_id: str, db: Session = Depends(get_db)) -> RoleRead:
    try:
        role = RoleService(db).get(role_id)
    except RoleNotFound:
        raise HTTPException(status_code=404, detail="Role not found")
    return RoleRead.model_validate(role)


@router.put("/{role_id}", response_model=RoleRead)
def update_role(role_id: str, payload: RoleUpdate, db: Session = Depends(get_db)) -> RoleRead:
    try:
        role = RoleService(db).update(role_id, payload)
    except RoleNotFound:
        raise HTTPException(status_code=404, detail="Role not found")
    return RoleRead.model_validate(role)


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role(role_id: str, db: Session = Depends(get_db)) -> None:
    try:
        RoleService(db).delete(role_id)
    except RoleNotFound:
        raise HTTPException(status_code=404, detail="Role not found")
