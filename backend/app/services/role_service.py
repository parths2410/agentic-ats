from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.candidate import Candidate
from app.models.criterion import Criterion
from app.models.role import Role
from app.schemas.role import RoleCreate, RoleUpdate


class RoleNotFound(Exception):
    pass


class RoleService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(self, data: RoleCreate) -> Role:
        role = Role(title=data.title.strip(), job_description=data.job_description or "")
        self.db.add(role)
        self.db.commit()
        self.db.refresh(role)
        return role

    def get(self, role_id: str) -> Role:
        role = self.db.get(Role, role_id)
        if role is None:
            raise RoleNotFound(role_id)
        return role

    def list_with_counts(self) -> list[tuple[Role, int, int]]:
        candidate_count = (
            select(Candidate.role_id, func.count(Candidate.id).label("c"))
            .group_by(Candidate.role_id)
            .subquery()
        )
        criterion_count = (
            select(Criterion.role_id, func.count(Criterion.id).label("c"))
            .group_by(Criterion.role_id)
            .subquery()
        )
        stmt = (
            select(
                Role,
                func.coalesce(candidate_count.c.c, 0),
                func.coalesce(criterion_count.c.c, 0),
            )
            .outerjoin(candidate_count, candidate_count.c.role_id == Role.id)
            .outerjoin(criterion_count, criterion_count.c.role_id == Role.id)
            .order_by(Role.created_at.desc())
        )
        return [(row[0], row[1], row[2]) for row in self.db.execute(stmt).all()]

    def update(self, role_id: str, data: RoleUpdate) -> Role:
        role = self.get(role_id)
        if data.title is not None:
            role.title = data.title.strip()
        if data.job_description is not None:
            role.job_description = data.job_description
        self.db.commit()
        self.db.refresh(role)
        return role

    def delete(self, role_id: str) -> None:
        role = self.get(role_id)
        self.db.delete(role)
        self.db.commit()


def mark_role_scores_stale(db, role_id: str) -> int:
    """Mark every scored candidate for a role as having stale scores.

    Called whenever the role's criteria change so the UI can prompt the user
    to re-score before trusting the rankings.
    """
    from app.models.candidate import Candidate

    rows = (
        db.query(Candidate)
        .filter(Candidate.role_id == role_id)
        .filter(Candidate.aggregate_score.is_not(None))
        .all()
    )
    for c in rows:
        c.stale_scores = True
    db.commit()
    return len(rows)
