"""WebSocket-level tests for the chat endpoint.

Strategy:
- Override the LLM resolver to return a scripted fake.
- Patch the SessionLocal binding inside `app.api.websocket` so the WS handler
  uses the in-memory test DB.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api import websocket as ws_module
from app.llm.types import LLMResponse, ToolCall
from app.main import app


class _ScriptedLLM:
    def __init__(self, responses):
        self.responses = list(responses)

    async def chat(self, *_a, **_kw):
        return self.responses.pop(0)

    async def extract_criteria(self, _):
        return []

    async def parse_resume(self, _):
        return {}

    async def score_candidate(self, *_a):
        return {"scores": []}


@pytest.fixture()
def client(session_factory, monkeypatch):
    monkeypatch.setattr(ws_module, "SessionLocal", session_factory)
    yield TestClient(app)


def test_unknown_role_closes_with_error(client, monkeypatch):
    monkeypatch.setattr(
        ws_module, "_resolve_llm", lambda: _ScriptedLLM([LLMResponse(text="hi")])
    )
    with client.websocket_connect("/ws/roles/missing/chat") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "error"
        assert "Role not found" in msg["message"]


def test_text_only_chat_completes(client, role, monkeypatch):
    monkeypatch.setattr(
        ws_module, "_resolve_llm", lambda: _ScriptedLLM([LLMResponse(text="hello there")])
    )
    with client.websocket_connect(f"/ws/roles/{role.id}/chat") as ws:
        ready = ws.receive_json()
        assert ready["type"] == "ready"
        ws.send_json({"type": "chat_message", "content": "hi"})
        complete = ws.receive_json()
        assert complete["type"] == "chat_complete"
        assert complete["content"] == "hello there"
        assert complete["iterations"] == 1


def test_tool_status_events_emitted_during_loop(client, role, candidates, monkeypatch):
    responses = [
        LLMResponse(
            text="",
            tool_calls=[ToolCall(id="t1", name="get_candidates", arguments={"limit": 2})],
            stop_reason="tool_use",
        ),
        LLMResponse(text="Top: Ada, Grace"),
    ]
    monkeypatch.setattr(ws_module, "_resolve_llm", lambda: _ScriptedLLM(responses))

    with client.websocket_connect(f"/ws/roles/{role.id}/chat") as ws:
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "chat_message", "content": "Top 2?"})

        events = []
        while True:
            evt = ws.receive_json()
            events.append(evt)
            if evt["type"] == "chat_complete":
                break

        types = [e["type"] for e in events]
        assert types.count("tool_status") == 2  # executing + complete
        assert "Top: Ada" in events[-1]["content"]


def test_empty_message_returns_error_and_keeps_socket_open(client, role, monkeypatch):
    monkeypatch.setattr(
        ws_module, "_resolve_llm", lambda: _ScriptedLLM([LLMResponse(text="ok")])
    )
    with client.websocket_connect(f"/ws/roles/{role.id}/chat") as ws:
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "chat_message", "content": "   "})
        first = ws.receive_json()
        assert first["type"] == "error"
        ws.send_json({"type": "chat_message", "content": "hi"})
        complete = ws.receive_json()
        assert complete["type"] == "chat_complete"


def test_unknown_payload_type_is_ignored(client, role, monkeypatch):
    monkeypatch.setattr(
        ws_module, "_resolve_llm", lambda: _ScriptedLLM([LLMResponse(text="ok")])
    )
    with client.websocket_connect(f"/ws/roles/{role.id}/chat") as ws:
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "ping"})
        ws.send_json({"type": "chat_message", "content": "hi"})
        complete = ws.receive_json()
        assert complete["type"] == "chat_complete"


def test_llm_unavailable_closes_socket(client, role, monkeypatch):
    def raises():
        raise RuntimeError("missing key")

    monkeypatch.setattr(ws_module, "_resolve_llm", raises)
    with client.websocket_connect(f"/ws/roles/{role.id}/chat") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "error"
        assert "LLM unavailable" in msg["message"]


def test_chat_turn_failure_emits_error(client, role, monkeypatch):
    class _BoomLLM(_ScriptedLLM):
        async def chat(self, *_a, **_kw):
            raise RuntimeError("api boom")

    monkeypatch.setattr(ws_module, "_resolve_llm", lambda: _BoomLLM([]))
    with client.websocket_connect(f"/ws/roles/{role.id}/chat") as ws:
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "chat_message", "content": "hi"})
        evt = ws.receive_json()
        assert evt["type"] == "error"
        assert "api boom" in evt["message"]
