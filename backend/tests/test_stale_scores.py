"""Stale-scores end-to-end:
- Editing criteria marks scored candidates stale.
- Re-scoring clears the stale flag.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.llm import get_llm_provider
from app.main import app
from app.models.candidate import Candidate
from app.services.role_service import mark_role_scores_stale


class _StubLLM:
    async def parse_resume(self, _):
        return {}

    async def score_candidate(self, *_a):
        return {"scores": []}

    async def extract_criteria(self, _):
        return []


@pytest.fixture()
def client(session_factory):
    def _override():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    app.dependency_overrides[get_llm_provider] = lambda: _StubLLM()
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_mark_role_scores_stale_only_touches_scored_candidates(db, role, candidates):
    # candidates[0] and candidates[2] are scored, candidates[1] is pending.
    n = mark_role_scores_stale(db, role.id)
    assert n == 2
    db.expire_all()
    assert db.get(Candidate, candidates[0].id).stale_scores is True
    assert db.get(Candidate, candidates[1].id).stale_scores is False
    assert db.get(Candidate, candidates[2].id).stale_scores is True


def test_create_criterion_marks_scored_candidates_stale(client, role, candidates):
    # Wire `role`/`candidates` into the same session_factory the client uses
    # by adding the criterion via the API.
    r = client.post(
        f"/api/roles/{role.id}/criteria", json={"name": "NewC", "weight": 1.0}
    )
    assert r.status_code == 201
    listed = client.get(f"/api/roles/{role.id}/candidates").json()
    assert any(c["stale_scores"] for c in listed if c["aggregate_score"] is not None)


def test_update_criterion_marks_stale(client, role, criteria, candidates):
    cid = criteria[0].id
    r = client.put(f"/api/roles/{role.id}/criteria/{cid}", json={"weight": 0.7})
    assert r.status_code == 200
    listed = client.get(f"/api/roles/{role.id}/candidates").json()
    assert any(c["stale_scores"] for c in listed if c["aggregate_score"] is not None)


def test_delete_criterion_marks_stale(client, role, criteria, candidates):
    cid = criteria[1].id
    r = client.delete(f"/api/roles/{role.id}/criteria/{cid}")
    assert r.status_code == 204
    listed = client.get(f"/api/roles/{role.id}/candidates").json()
    assert any(c["stale_scores"] for c in listed if c["aggregate_score"] is not None)
