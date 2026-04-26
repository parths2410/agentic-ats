from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    # Import models so they register with Base.metadata before create_all.
    from app.models import role, criterion, candidate, chat, ui_state  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _apply_inplace_migrations()


def _apply_inplace_migrations() -> None:
    """Add columns SQLAlchemy added to models that aren't yet in the SQLite file.

    Tiny v1 substitute for Alembic — only handles ADD COLUMN on existing tables,
    which is all SQLite supports without a table rewrite anyway.
    """
    insp = inspect(engine)
    if "candidates" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("candidates")}
    additions: list[str] = []
    if "status" not in existing:
        additions.append("ALTER TABLE candidates ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending'")
    if "error_message" not in existing:
        additions.append("ALTER TABLE candidates ADD COLUMN error_message TEXT")
    if not additions:
        return
    with engine.begin() as conn:
        for stmt in additions:
            conn.execute(text(stmt))
