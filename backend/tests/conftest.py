"""Shared pytest fixtures.

Use an in-memory SQLite database with a SessionLocal override that points
at it, so each test gets an isolated, fast environment with no on-disk
state pollution.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import database as db_module
from app.database import Base


@pytest.fixture()
def engine():
    # StaticPool keeps a single connection alive so :memory: tables persist
    # across the test's many session checkouts.
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Import models so they register with Base.metadata.
    from app.models import candidate, chat, criterion, role  # noqa: F401

    Base.metadata.create_all(bind=eng)
    yield eng
    eng.dispose()


@pytest.fixture()
def session_factory(engine, monkeypatch):
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(db_module, "engine", engine)
    monkeypatch.setattr(db_module, "SessionLocal", factory)
    return factory


@pytest.fixture()
def db(session_factory):
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def role(db):
    from app.models.role import Role

    r = Role(title="Backend Engineer", job_description="Build backends.")
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@pytest.fixture()
def criteria(db, role):
    from app.models.criterion import Criterion

    items = [
        Criterion(role_id=role.id, name="Python", description="Py", weight=1.0,
                  source="auto", order_index=1),
        Criterion(role_id=role.id, name="Leadership", description="Ld", weight=0.5,
                  source="auto", order_index=2),
    ]
    for c in items:
        db.add(c)
    db.commit()
    for c in items:
        db.refresh(c)
    return items


@pytest.fixture()
def candidates(db, role, criteria):
    """Three candidates: scored, unscored-pending, scored-with-no-skills."""
    from app.models.candidate import Candidate, CriterionScore

    c1 = Candidate(
        role_id=role.id,
        name="Ada Lovelace",
        raw_text="Ada is a Python guru in California with leadership at Google.",
        structured_profile={
            "name": "Ada Lovelace",
            "contact_info": {"location": "Berkeley, California", "email": "ada@x.io"},
            "skills": ["Python", "Postgres"],
            "experiences": [
                {"title": "Staff Engineer", "company": "Google",
                 "start_date": "2020", "end_date": "Present"}
            ],
            "education": [{"degree": "PhD", "field": "CS", "institution": "Berkeley"}],
        },
        pdf_filename="ada.pdf",
        aggregate_score=8.5,
        rank=1,
        status="complete",
    )
    c2 = Candidate(
        role_id=role.id,
        name=None,
        raw_text="",
        structured_profile=None,
        pdf_filename="pending.pdf",
        status="pending",
    )
    c3 = Candidate(
        role_id=role.id,
        name="Grace Hopper",
        raw_text="Grace built compilers in Texas.",
        structured_profile={
            "name": "Grace Hopper",
            "contact_info": {"location": "Austin, Texas"},
            "skills": ["COBOL"],
            "experiences": [
                {"title": "Engineer", "company": "Navy",
                 "start_date": "1950", "end_date": "1986"}
            ],
            "education": [{"degree": "PhD", "field": "Math", "institution": "Yale"}],
        },
        pdf_filename="grace.pdf",
        aggregate_score=6.0,
        rank=2,
        status="complete",
    )
    for c in (c1, c2, c3):
        db.add(c)
    db.commit()
    for c in (c1, c2, c3):
        db.refresh(c)

    py = next(cr for cr in criteria if cr.name == "Python")
    ld = next(cr for cr in criteria if cr.name == "Leadership")
    db.add(CriterionScore(candidate_id=c1.id, criterion_id=py.id, score=9.0,
                          rationale="Python pro"))
    db.add(CriterionScore(candidate_id=c1.id, criterion_id=ld.id, score=8.0,
                          rationale="Led teams"))
    db.add(CriterionScore(candidate_id=c3.id, criterion_id=py.id, score=4.0,
                          rationale="No Python evidence"))
    db.add(CriterionScore(candidate_id=c3.id, criterion_id=ld.id, score=8.0,
                          rationale="Strong leadership"))
    db.commit()
    return [c1, c2, c3]
