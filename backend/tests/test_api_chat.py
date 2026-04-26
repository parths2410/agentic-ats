import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models.chat import ChatMessage


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


def test_history_for_unknown_role_404(client):
    r = client.get("/api/roles/missing/chat/history")
    assert r.status_code == 404


def test_delete_history_unknown_role_404(client):
    r = client.delete("/api/roles/missing/chat/history")
    assert r.status_code == 404


def test_history_empty_then_after_seed(client, session_factory, role):
    r = client.get(f"/api/roles/{role.id}/chat/history")
    assert r.status_code == 200
    assert r.json() == {"messages": []}

    db = session_factory()
    try:
        db.add(ChatMessage(role_id=role.id, role_enum="user", content="hi"))
        db.add(ChatMessage(role_id=role.id, role_enum="assistant", content="hello"))
        db.commit()
    finally:
        db.close()

    r2 = client.get(f"/api/roles/{role.id}/chat/history")
    body = r2.json()
    assert len(body["messages"]) == 2
    assert body["messages"][0]["content"] == "hi"
    assert body["messages"][1]["role_enum"] == "assistant"


def test_delete_history_clears_messages(client, session_factory, role):
    db = session_factory()
    try:
        db.add(ChatMessage(role_id=role.id, role_enum="user", content="x"))
        db.add(ChatMessage(role_id=role.id, role_enum="assistant", content="y"))
        db.commit()
    finally:
        db.close()

    r = client.delete(f"/api/roles/{role.id}/chat/history")
    assert r.status_code == 204
    r2 = client.get(f"/api/roles/{role.id}/chat/history")
    assert r2.json() == {"messages": []}


def test_get_ui_state_initial_empty(client, role):
    r = client.get(f"/api/roles/{role.id}/chat/ui-state")
    assert r.status_code == 200
    assert r.json()["highlighted_candidate_ids"] == []


def test_get_ui_state_unknown_role(client):
    r = client.get("/api/roles/missing/chat/ui-state")
    assert r.status_code == 404


def test_reset_endpoint_clears_state(client, session_factory, role):
    from app.services.ui_state_service import UIStateService

    db = session_factory()
    try:
        UIStateService(db).set_sort(role.id, "Python", "desc")
        UIStateService(db).add_highlights(role.id, ["a", "b"])
    finally:
        db.close()
    r = client.post(f"/api/roles/{role.id}/chat/reset")
    assert r.status_code == 200
    body = r.json()
    assert body["highlighted_candidate_ids"] == []
    assert body["current_sort_field"] is None


def test_reset_unknown_role(client):
    r = client.post("/api/roles/missing/chat/reset")
    assert r.status_code == 404
