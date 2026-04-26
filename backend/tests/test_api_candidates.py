import asyncio

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.llm import get_llm_provider
from app.main import app


class _StubLLM:
    async def parse_resume(self, _):
        return {"name": "Q", "skills": [], "experiences": [], "education": []}

    async def score_candidate(self, *_a):
        return {"scores": []}

    async def extract_criteria(self, _):
        return []


@pytest.fixture()
def client(session_factory, monkeypatch):
    # Force background processing tasks not to fire (they require event loop +
    # a session that points at our in-memory DB; we already have stand-alone
    # tests for the pipeline).
    monkeypatch.setattr(
        "app.api.candidates.asyncio.create_task", lambda coro: coro.close() or None
    )
    monkeypatch.setattr(
        "app.api.scoring.asyncio.create_task", lambda coro: coro.close() or None
    )

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


def _create_role(client) -> str:
    return client.post("/api/roles", json={"title": "T"}).json()["id"]


def test_upload_validates_pdf_content_type(client):
    rid = _create_role(client)
    files = {"files": ("notes.txt", b"plain text", "text/plain")}
    r = client.post(f"/api/roles/{rid}/candidates/upload", files=files)
    assert r.status_code == 400


def test_upload_rejects_empty_file(client):
    rid = _create_role(client)
    files = {"files": ("empty.pdf", b"", "application/pdf")}
    r = client.post(f"/api/roles/{rid}/candidates/upload", files=files)
    assert r.status_code == 400


def test_upload_unknown_role(client):
    files = {"files": ("a.pdf", b"%PDF-1.4", "application/pdf")}
    r = client.post("/api/roles/unknown/candidates/upload", files=files)
    assert r.status_code == 404


def test_upload_returns_pending_candidates(client):
    rid = _create_role(client)
    files = [("files", ("a.pdf", b"%PDF-1.4 hi", "application/pdf"))]
    r = client.post(f"/api/roles/{rid}/candidates/upload", files=files)
    assert r.status_code == 202
    body = r.json()
    assert len(body["candidates"]) == 1
    assert body["candidates"][0]["status"] == "pending"


def test_list_unknown_role(client):
    r = client.get("/api/roles/x/candidates")
    assert r.status_code == 404


def test_list_after_upload(client):
    rid = _create_role(client)
    files = [("files", ("a.pdf", b"%PDF-1.4", "application/pdf"))]
    client.post(f"/api/roles/{rid}/candidates/upload", files=files)
    r = client.get(f"/api/roles/{rid}/candidates")
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_get_candidate_not_found(client):
    rid = _create_role(client)
    r = client.get(f"/api/roles/{rid}/candidates/missing")
    assert r.status_code == 404


def test_get_candidate_scores_unknown(client):
    rid = _create_role(client)
    r = client.get(f"/api/roles/{rid}/candidates/missing/scores")
    assert r.status_code == 404


def test_delete_candidate(client):
    rid = _create_role(client)
    files = [("files", ("a.pdf", b"%PDF-1.4 hi", "application/pdf"))]
    cid = client.post(f"/api/roles/{rid}/candidates/upload", files=files).json()["candidates"][0]["id"]
    r = client.delete(f"/api/roles/{rid}/candidates/{cid}")
    assert r.status_code == 204


def test_delete_unknown(client):
    rid = _create_role(client)
    r = client.delete(f"/api/roles/{rid}/candidates/missing")
    assert r.status_code == 404


def test_get_candidate_detail(client):
    rid = _create_role(client)
    files = [("files", ("a.pdf", b"%PDF-1.4 hi", "application/pdf"))]
    cid = client.post(f"/api/roles/{rid}/candidates/upload", files=files).json()["candidates"][0]["id"]
    r = client.get(f"/api/roles/{rid}/candidates/{cid}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == cid
    assert "raw_text" in body


def test_upload_no_files_rejected(client):
    rid = _create_role(client)
    # FastAPI itself rejects when no `files` field is present.
    r = client.post(f"/api/roles/{rid}/candidates/upload")
    assert r.status_code in (400, 422)


def test_rescore_endpoint_unknown_role(client):
    r = client.post("/api/roles/x/score")
    assert r.status_code == 404


def test_rescore_endpoint_accepted(client):
    rid = _create_role(client)
    r = client.post(f"/api/roles/{rid}/score")
    assert r.status_code == 202
    assert r.json() == {"status": "rescore_started"}


def test_get_pdf_returns_blob(client):
    rid = _create_role(client)
    pdf_bytes = b"%PDF-1.4\nfake content"
    files = [("files", ("hello.pdf", pdf_bytes, "application/pdf"))]
    cid = client.post(
        f"/api/roles/{rid}/candidates/upload", files=files
    ).json()["candidates"][0]["id"]
    r = client.get(f"/api/roles/{rid}/candidates/{cid}/pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert "inline" in r.headers["content-disposition"]
    assert "hello.pdf" in r.headers["content-disposition"]
    assert r.content == pdf_bytes


def test_get_pdf_unknown_role(client):
    r = client.get("/api/roles/missing/candidates/whatever/pdf")
    assert r.status_code == 404


def test_get_pdf_unknown_candidate(client):
    rid = _create_role(client)
    r = client.get(f"/api/roles/{rid}/candidates/missing/pdf")
    assert r.status_code == 404


def test_get_pdf_candidate_belongs_to_other_role(client):
    rid_a = _create_role(client)
    rid_b = _create_role(client)
    files = [("files", ("a.pdf", b"%PDF-1.4", "application/pdf"))]
    cid = client.post(
        f"/api/roles/{rid_a}/candidates/upload", files=files
    ).json()["candidates"][0]["id"]
    r = client.get(f"/api/roles/{rid_b}/candidates/{cid}/pdf")
    assert r.status_code == 404


def test_get_pdf_when_blob_missing(client, session_factory):
    rid = _create_role(client)
    files = [("files", ("a.pdf", b"%PDF-1.4 hi", "application/pdf"))]
    cid = client.post(
        f"/api/roles/{rid}/candidates/upload", files=files
    ).json()["candidates"][0]["id"]
    # Simulate the blob being absent — older rows or future migrations.
    db = session_factory()
    try:
        from app.models.candidate import Candidate
        cand = db.get(Candidate, cid)
        cand.pdf_blob = None
        db.commit()
    finally:
        db.close()
    r = client.get(f"/api/roles/{rid}/candidates/{cid}/pdf")
    assert r.status_code == 404
    assert "No PDF stored" in r.json()["detail"]


def test_get_pdf_strips_quotes_in_filename(client, session_factory):
    rid = _create_role(client)
    files = [("files", ("a.pdf", b"%PDF-1.4", "application/pdf"))]
    cid = client.post(
        f"/api/roles/{rid}/candidates/upload", files=files
    ).json()["candidates"][0]["id"]
    # Force a filename with embedded quotes to ensure the header doesn't break.
    db = session_factory()
    try:
        from app.models.candidate import Candidate
        cand = db.get(Candidate, cid)
        cand.pdf_filename = 'weird"name.pdf'
        db.commit()
    finally:
        db.close()
    r = client.get(f"/api/roles/{rid}/candidates/{cid}/pdf")
    assert r.status_code == 200
    assert '"weirdname.pdf"' in r.headers["content-disposition"]
