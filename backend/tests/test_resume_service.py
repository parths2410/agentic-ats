"""Unit tests for the resume processing pipeline.

We mock the LLM provider and the PDF text extractor — neither belongs in a
unit test.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from app.models.candidate import Candidate
from app.services.resume_service import (
    ResumeService,
    _normalize_name,
    candidates_for_role,
)


class _FakeLLM:
    def __init__(
        self,
        parse_result: dict | Exception | None = None,
        score_result: dict | Exception | None = None,
    ) -> None:
        self.parse_result = parse_result or {
            "name": "Jane",
            "skills": ["Python"],
            "experiences": [],
            "education": [],
        }
        self.score_result = score_result or {
            "scores": [{"criterion_name": "Python", "score": 9, "rationale": "ok"}],
            "overall_summary": "fit",
        }
        self.parse_calls = 0
        self.score_calls = 0

    async def parse_resume(self, _raw):
        self.parse_calls += 1
        if isinstance(self.parse_result, Exception):
            raise self.parse_result
        return self.parse_result

    async def score_candidate(self, _profile, _jd, _criteria):
        self.score_calls += 1
        if isinstance(self.score_result, Exception):
            raise self.score_result
        return self.score_result

    async def extract_criteria(self, _jd):
        return []


# ---- normalize ----


def test_normalize_name_strips_parens_and_lowercases():
    assert _normalize_name("Python (must)") == "python"
    assert _normalize_name("  Backend Eng. ") == "backend eng."


# ---- create_candidates ----


def test_create_candidates_persists_pdf_and_filename(db, role):
    svc = ResumeService(db, _FakeLLM())
    out = svc.create_candidates(role.id, [("a.pdf", b"%PDF-1"), ("b.pdf", b"%PDF-2")])
    assert len(out) == 2
    assert {c.pdf_filename for c in out} == {"a.pdf", "b.pdf"}
    assert all(c.status == "pending" for c in out)


# ---- _persist_scores via re-processing ----


@pytest.mark.asyncio
async def test_process_one_full_pipeline_succeeds(db, role, criteria, session_factory, monkeypatch):
    monkeypatch.setattr(
        "app.services.resume_service.SessionLocal", session_factory
    )
    monkeypatch.setattr(
        "app.services.resume_service.extract_text",
        lambda _b: "raw resume text contents",
    )

    parse = {"name": "Jane Doe", "skills": ["Python"], "experiences": [], "education": [],
             "confidence_scores": {"name": "high"}}
    score = {
        "scores": [
            {"criterion_name": "Python", "score": 8.0, "rationale": "good"},
            {"criterion_name": "Leadership", "score": 6.0, "rationale": "ok"},
        ],
        "overall_summary": "fit",
    }
    llm = _FakeLLM(parse_result=parse, score_result=score)
    svc = ResumeService(db, llm)
    [cand] = svc.create_candidates(role.id, [("r.pdf", b"%PDF-1")])

    await svc.process_candidates_async(role.id, [cand.id])

    db.expire_all()
    refreshed = db.get(Candidate, cand.id)
    assert refreshed.status == "complete"
    assert refreshed.name == "Jane Doe"
    assert refreshed.aggregate_score == round(
        (1.0 * 8.0 + 0.5 * 6.0) / 1.5, 2
    )
    assert llm.parse_calls == 1 and llm.score_calls == 1


@pytest.mark.asyncio
async def test_process_one_marks_error_when_text_empty(
    db, role, criteria, session_factory, monkeypatch
):
    monkeypatch.setattr(
        "app.services.resume_service.SessionLocal", session_factory
    )
    monkeypatch.setattr("app.services.resume_service.extract_text", lambda _b: "")
    svc = ResumeService(db, _FakeLLM())
    [cand] = svc.create_candidates(role.id, [("r.pdf", b"x")])

    await svc.process_candidates_async(role.id, [cand.id])
    db.expire_all()
    refreshed = db.get(Candidate, cand.id)
    assert refreshed.status == "error"
    assert "No text" in (refreshed.error_message or "")


@pytest.mark.asyncio
async def test_process_one_marks_error_when_llm_fails(
    db, role, criteria, session_factory, monkeypatch
):
    monkeypatch.setattr(
        "app.services.resume_service.SessionLocal", session_factory
    )
    monkeypatch.setattr("app.services.resume_service.extract_text", lambda _b: "ok text " * 20)
    svc = ResumeService(db, _FakeLLM(parse_result=RuntimeError("LLM down")))
    [cand] = svc.create_candidates(role.id, [("r.pdf", b"x")])

    await svc.process_candidates_async(role.id, [cand.id])
    db.expire_all()
    refreshed = db.get(Candidate, cand.id)
    assert refreshed.status == "error"


@pytest.mark.asyncio
async def test_process_returns_silently_for_missing_role(session_factory, monkeypatch):
    monkeypatch.setattr(
        "app.services.resume_service.SessionLocal", session_factory
    )
    db = session_factory()
    try:
        svc = ResumeService(db, _FakeLLM())
        # No-op when role is unknown.
        await svc.process_candidates_async("nope", [])
    finally:
        db.close()


@pytest.mark.asyncio
async def test_rescore_role_updates_existing_scores(
    db, role, criteria, session_factory, monkeypatch
):
    monkeypatch.setattr(
        "app.services.resume_service.SessionLocal", session_factory
    )
    monkeypatch.setattr("app.services.resume_service.extract_text", lambda _b: "txt " * 30)
    parse = {"name": "X", "skills": [], "experiences": [], "education": []}
    score = {
        "scores": [
            {"criterion_name": "Python", "score": 5.0, "rationale": "r"},
            {"criterion_name": "Leadership", "score": 5.0, "rationale": "r"},
        ],
    }
    llm = _FakeLLM(parse_result=parse, score_result=score)
    svc = ResumeService(db, llm)
    [cand] = svc.create_candidates(role.id, [("r.pdf", b"x")])
    await svc.process_candidates_async(role.id, [cand.id])

    # Now adjust score result and rescore.
    llm.score_result = {
        "scores": [
            {"criterion_name": "Python", "score": 10.0, "rationale": "r"},
            {"criterion_name": "Leadership", "score": 1.0, "rationale": "r"},
        ],
    }
    await svc.rescore_role(role.id)
    db.expire_all()
    refreshed = db.get(Candidate, cand.id)
    assert refreshed.aggregate_score == round((10.0 + 0.5 * 1.0) / 1.5, 2)


@pytest.mark.asyncio
async def test_rescore_no_eligible_candidates_returns(
    db, role, session_factory, monkeypatch
):
    monkeypatch.setattr(
        "app.services.resume_service.SessionLocal", session_factory
    )
    svc = ResumeService(db, _FakeLLM())
    # No candidates at all — should be a no-op.
    await svc.rescore_role(role.id)


def test_persist_scores_marks_error_when_no_match(db, role, criteria, session_factory, monkeypatch):
    monkeypatch.setattr(
        "app.services.resume_service.SessionLocal", session_factory
    )
    svc = ResumeService(db, _FakeLLM())
    [cand] = svc.create_candidates(role.id, [("r.pdf", b"x")])
    crit_dicts = [
        {"id": c.id, "name": c.name, "description": c.description, "weight": c.weight}
        for c in criteria
    ]
    svc._persist_scores(
        cand.id,
        {"scores": [{"criterion_name": "Random Other", "score": 5, "rationale": "x"}]},
        crit_dicts,
    )
    db.expire_all()
    refreshed = db.get(Candidate, cand.id)
    assert refreshed.status == "error"
    assert refreshed.aggregate_score is None


def test_candidates_for_role_orders_by_rank(db, role, candidates):
    out = candidates_for_role(db, role.id)
    # ranks 1, 2, then unranked
    assert out[0].rank == 1 and out[1].rank == 2
    assert out[2].rank is None
