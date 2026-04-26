import pytest
from fastapi.testclient import TestClient

from app.api import websocket as ws_module
from app.main import app


@pytest.fixture()
def client(session_factory, monkeypatch):
    monkeypatch.setattr(ws_module, "SessionLocal", session_factory)
    return TestClient(app)


def test_progress_unknown_role_emits_error(client):
    with client.websocket_connect("/ws/roles/missing/progress") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "error"


def test_progress_known_role_sends_ready(client, role):
    with client.websocket_connect(f"/ws/roles/{role.id}/progress") as ws:
        msg = ws.receive_json()
        assert msg == {"type": "ready", "role_id": role.id}
        # Closing the socket triggers WebSocketDisconnect on the server side,
        # exercising the cleanup path.
