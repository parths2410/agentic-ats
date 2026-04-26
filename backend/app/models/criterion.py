import uuid

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Criterion(Base):
    __tablename__ = "criteria"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    role_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("roles.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    weight: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="auto", nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    role: Mapped["Role"] = relationship("Role", back_populates="criteria")  # noqa: F821
    scores: Mapped[list["CriterionScore"]] = relationship(  # noqa: F821
        "CriterionScore", back_populates="criterion", cascade="all, delete-orphan"
    )
