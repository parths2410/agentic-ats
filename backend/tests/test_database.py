from sqlalchemy import inspect

from app import database as db_module
from app.database import Base, init_db


def test_init_db_creates_all_expected_tables(monkeypatch, tmp_path):
    test_db = tmp_path / "x.db"
    from sqlalchemy import create_engine
    eng = create_engine(f"sqlite:///{test_db}", connect_args={"check_same_thread": False})
    monkeypatch.setattr(db_module, "engine", eng)
    init_db()
    tables = set(inspect(eng).get_table_names())
    assert {"roles", "criteria", "candidates", "criterion_scores", "chat_messages"} <= tables


def test_get_db_yields_and_closes(session_factory):
    monkey_db = next(db_module.get_db())
    assert monkey_db is not None


def test_inplace_migration_adds_status_and_error_columns(monkeypatch, tmp_path):
    """Simulate an old DB lacking the status/error_message columns."""
    from sqlalchemy import create_engine, text

    db_file = tmp_path / "legacy.db"
    eng = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})
    # Build a candidates table missing the new columns.
    with eng.begin() as conn:
        conn.execute(text(
            "CREATE TABLE candidates ("
            " id VARCHAR(36) PRIMARY KEY,"
            " role_id VARCHAR(36) NOT NULL,"
            " name TEXT,"
            " raw_text TEXT NOT NULL DEFAULT ''"
            ")"
        ))

    monkeypatch.setattr(db_module, "engine", eng)
    db_module._apply_inplace_migrations()
    cols = {c["name"] for c in inspect(eng).get_columns("candidates")}
    assert "status" in cols and "error_message" in cols


def test_inplace_migration_noop_when_no_table(monkeypatch, tmp_path):
    from sqlalchemy import create_engine

    db_file = tmp_path / "empty.db"
    eng = create_engine(f"sqlite:///{db_file}", connect_args={"check_same_thread": False})
    monkeypatch.setattr(db_module, "engine", eng)
    db_module._apply_inplace_migrations()  # must not raise
