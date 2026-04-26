from sqlalchemy import ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UIState(Base):
    """Per-role UI state driven by chat action tools.

    There's exactly one row per role; the role_id doubles as the primary key.
    The chat reset endpoint deletes (or clears) this row.
    """

    __tablename__ = "ui_states"

    role_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    highlighted_candidate_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    sort_field: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sort_order: Mapped[str | None] = mapped_column(String(8), nullable=True)
