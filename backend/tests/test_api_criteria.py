import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.llm import get_llm_provider
from app.main import app
from app.schemas.criterion import CriterionProposal


class _StubLLM:
    """Minimal stand-in for the LLMProvider that returns canned criteria."""

    def __init__(self, *, fail: Exception | None = None):
        self.fail = fail

    async def extract_criteria(self, _job_description):
        if self.fail:
            raise self.fail
        return [
            CriterionProposal(name="Python", description="d", weight=1.0, source="auto"),
            CriterionProposal(name="Leadership", description="d", weight=0.5, source="auto"),
        ]

    async def parse_resume(self, _t):
        return {}

    async def score_candidate(self, *_a):
        return {"scores": []}


@pytest.fixture()
def client_factory(session_factory):
    def make(llm: _StubLLM | None = None):
        def _override():
            db = session_factory()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = _override
        if llm is not None:
            app.dependency_overrides[get_llm_provider] = lambda: llm
        return TestClient(app)

    yield make
    app.dependency_overrides.clear()


def _create_role(client, jd: str = "JD") -> str:
    r = client.post("/api/roles", json={"title": "Eng", "job_description": jd})
    return r.json()["id"]


def test_extract_returns_proposals(client_factory):
    client = client_factory(_StubLLM())
    rid = _create_role(client)
    r = client.post(f"/api/roles/{rid}/criteria/extract")
    assert r.status_code == 200
    body = r.json()
    assert {p["name"] for p in body["proposals"]} == {"Python", "Leadership"}


def test_extract_unknown_role(client_factory):
    client = client_factory(_StubLLM())
    r = client.post("/api/roles/missing/criteria/extract")
    assert r.status_code == 404


def test_extract_empty_jd_400(client_factory):
    client = client_factory(_StubLLM())
    rid = _create_role(client, jd="")
    r = client.post(f"/api/roles/{rid}/criteria/extract")
    assert r.status_code == 400


def test_extract_llm_error_502(client_factory):
    from app.llm.anthropic_provider import LLMResponseError

    client = client_factory(_StubLLM(fail=LLMResponseError("bad json")))
    rid = _create_role(client)
    r = client.post(f"/api/roles/{rid}/criteria/extract")
    assert r.status_code == 502


def test_extract_generic_error_502(client_factory):
    client = client_factory(_StubLLM(fail=RuntimeError("boom")))
    rid = _create_role(client)
    r = client.post(f"/api/roles/{rid}/criteria/extract")
    assert r.status_code == 502


def test_create_list_update_delete_criterion(client_factory):
    client = client_factory(_StubLLM())
    rid = _create_role(client)

    create = client.post(
        f"/api/roles/{rid}/criteria",
        json={"name": "C1", "description": "x", "weight": 1.0},
    )
    assert create.status_code == 201
    cid = create.json()["id"]

    listed = client.get(f"/api/roles/{rid}/criteria").json()
    assert len(listed) == 1
    assert listed[0]["order_index"] >= 1

    upd = client.put(
        f"/api/roles/{rid}/criteria/{cid}", json={"name": "C1b", "weight": 0.7}
    )
    assert upd.status_code == 200
    assert upd.json()["name"] == "C1b"
    assert upd.json()["weight"] == 0.7

    delete = client.delete(f"/api/roles/{rid}/criteria/{cid}")
    assert delete.status_code == 204
    assert client.get(f"/api/roles/{rid}/criteria").json() == []


def test_create_criterion_unknown_role(client_factory):
    client = client_factory(_StubLLM())
    r = client.post("/api/roles/x/criteria", json={"name": "C", "weight": 1.0})
    assert r.status_code == 404


def test_update_unknown_criterion(client_factory):
    client = client_factory(_StubLLM())
    rid = _create_role(client)
    r = client.put(f"/api/roles/{rid}/criteria/missing", json={"weight": 1.0})
    assert r.status_code == 404


def test_delete_unknown_criterion(client_factory):
    client = client_factory(_StubLLM())
    rid = _create_role(client)
    r = client.delete(f"/api/roles/{rid}/criteria/missing")
    assert r.status_code == 404


def test_list_unknown_role(client_factory):
    client = client_factory(_StubLLM())
    r = client.get("/api/roles/x/criteria")
    assert r.status_code == 404


def test_create_criterion_with_explicit_order(client_factory):
    client = client_factory(_StubLLM())
    rid = _create_role(client)
    r = client.post(
        f"/api/roles/{rid}/criteria",
        json={"name": "X", "weight": 1.0, "order_index": 7},
    )
    assert r.json()["order_index"] == 7
