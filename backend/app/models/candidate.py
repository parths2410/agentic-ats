import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    role_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("roles.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    raw_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    structured_profile: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    parse_confidence: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    pdf_filename: Mapped[str | None] = mapped_column(String(512), nullable=True)
    pdf_blob: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    aggregate_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    stale_scores: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    role: Mapped["Role"] = relationship("Role", back_populates="candidates")  # noqa: F821
    scores: Mapped[list["CriterionScore"]] = relationship(  # noqa: F821
        "CriterionScore", back_populates="candidate", cascade="all, delete-orphan"
    )


class CriterionScore(Base):
    __tablename__ = "criterion_scores"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    candidate_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False
    )
    criterion_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("criteria.id", ondelete="CASCADE"), nullable=False
    )
    score: Mapped[float] = mapped_column(Float, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, default="", nullable=False)

    candidate: Mapped["Candidate"] = relationship("Candidate", back_populates="scores")
    criterion: Mapped["Criterion"] = relationship("Criterion", back_populates="scores")  # noqa: F821
