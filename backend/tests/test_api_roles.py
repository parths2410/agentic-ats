"""HTTP-level tests for the roles router.

The TestClient drives the real FastAPI app with the in-memory DB swapped in
via the get_db dependency override.
"""

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app


@pytest.fixture()
def client(session_factory):
    def _override():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


def test_create_and_list_roles(client):
    r = client.post("/api/roles", json={"title": "Eng", "job_description": "JD"})
    assert r.status_code == 201
    role = r.json()
    assert role["title"] == "Eng"

    r2 = client.get("/api/roles")
    assert r2.status_code == 200
    items = r2.json()
    assert len(items) == 1
    assert items[0]["candidate_count"] == 0


def test_get_role_404(client):
    r = client.get("/api/roles/missing")
    assert r.status_code == 404


def test_create_validation_rejects_empty_title(client):
    r = client.post("/api/roles", json={"title": "", "job_description": ""})
    assert r.status_code == 422


def test_update_role(client):
    r = client.post("/api/roles", json={"title": "Old"})
    rid = r.json()["id"]
    r2 = client.put(f"/api/roles/{rid}", json={"title": "New"})
    assert r2.status_code == 200
    assert r2.json()["title"] == "New"


def test_update_unknown_404(client):
    r = client.put("/api/roles/x", json={"title": "y"})
    assert r.status_code == 404


def test_delete_role(client):
    r = client.post("/api/roles", json={"title": "Tmp"})
    rid = r.json()["id"]
    r2 = client.delete(f"/api/roles/{rid}")
    assert r2.status_code == 204
    r3 = client.get(f"/api/roles/{rid}")
    assert r3.status_code == 404


def test_delete_unknown(client):
    r = client.delete("/api/roles/x")
    assert r.status_code == 404


def test_get_role_after_create(client):
    r = client.post("/api/roles", json={"title": "Eng"})
    rid = r.json()["id"]
    r2 = client.get(f"/api/roles/{rid}")
    assert r2.status_code == 200
    assert r2.json()["title"] == "Eng"
