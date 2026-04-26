"""Unit tests for ChatService — the agentic loop.

We script the LLM provider with a list of canned LLMResponse turns; the
ToolRegistry executes against the real in-memory DB.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.llm.types import LLMMessage, LLMResponse, ToolCall
from app.models.chat import ChatMessage
from app.services.chat_service import (
    ChatService,
    RoleNotFound,
    ToolInvocation,
    _summarize,
)
from app.tools.registry import ToolRegistry


class _ScriptedLLM:
    def __init__(self, responses: list[LLMResponse]):
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    async def chat(self, messages, tools, system_prompt):
        self.calls.append({
            "messages": list(messages),
            "tools": list(tools),
            "system_prompt": system_prompt,
        })
        if not self.responses:
            return LLMResponse(text="(out of script)", tool_calls=[])
        return self.responses.pop(0)

    async def extract_criteria(self, _):
        return []

    async def parse_resume(self, _):
        return {}

    async def score_candidate(self, *_a):
        return {"scores": []}


@pytest.mark.asyncio
async def test_unknown_role_raises(db):
    svc = ChatService(db, _ScriptedLLM([LLMResponse(text="hi")]))
    with pytest.raises(RoleNotFound):
        await svc.handle_message("nope", "hi")


@pytest.mark.asyncio
async def test_text_only_response_is_persisted(db, role):
    llm = _ScriptedLLM([LLMResponse(text="Hello!")])
    svc = ChatService(db, llm)
    out = await svc.handle_message(role.id, "Who is the top candidate?")
    assert out.text == "Hello!"
    assert out.iterations == 1
    assert out.invocations == []
    rows = svc.load_history(role.id)
    assert [r.role_enum for r in rows] == ["user", "assistant"]
    assert rows[1].content == "Hello!"


@pytest.mark.asyncio
async def test_tool_call_round_trip_executes_and_loops(db, role, candidates):
    # First turn: ask for candidates. Second turn: produce final answer.
    llm = _ScriptedLLM([
        LLMResponse(
            text="",
            tool_calls=[ToolCall(id="t1", name="get_candidates", arguments={"limit": 2})],
            stop_reason="tool_use",
        ),
        LLMResponse(text="Top 2: Ada, Grace"),
    ])
    svc = ChatService(db, llm)
    out = await svc.handle_message(role.id, "Top 2?")
    assert out.text.startswith("Top 2")
    assert len(out.invocations) == 1
    inv = out.invocations[0]
    assert inv.name == "get_candidates"
    # The ToolInvocation result should reflect real data.
    assert inv.result["returned"] >= 2
    # Second LLM call must have included assistant tool_use + tool result.
    second_messages = llm.calls[1]["messages"]
    roles_sent = [m.role for m in second_messages]
    assert "assistant" in roles_sent and "tool" in roles_sent


@pytest.mark.asyncio
async def test_iteration_cap_truncates_loop(db, role):
    # Always emit a tool call — service should give up after max_iterations.
    looping_response = LLMResponse(
        text="",
        tool_calls=[ToolCall(id="x", name="get_ui_state", arguments={})],
        stop_reason="tool_use",
    )
    llm = _ScriptedLLM([looping_response] * 10)
    svc = ChatService(db, llm, max_iterations=3)
    out = await svc.handle_message(role.id, "loop forever")
    assert out.truncated
    assert out.iterations == 3
    assert "(no response" in out.text


@pytest.mark.asyncio
async def test_tool_executor_error_returned_to_loop(db, role):
    def boom(*_a, **_kw):
        raise RuntimeError("kaboom")

    reg = ToolRegistry(executors={"get_ui_state": boom})
    # Manually register a get_ui_state definition so registry.definitions()
    # contains something (not strictly required since the LLM is scripted).
    reg.register({"name": "get_ui_state", "description": "x", "input_schema": {}}, boom)
    llm = _ScriptedLLM([
        LLMResponse(
            text="",
            tool_calls=[ToolCall(id="t1", name="get_ui_state", arguments={})],
            stop_reason="tool_use",
        ),
        LLMResponse(text="Sorry, lookup failed."),
    ])
    svc = ChatService(db, llm, registry=reg)
    out = await svc.handle_message(role.id, "anything")
    assert out.text == "Sorry, lookup failed."
    assert out.invocations[0].result == {"error": "tool execution failed: kaboom"}


@pytest.mark.asyncio
async def test_tool_status_callbacks_fire(db, role, candidates):
    events: list[dict] = []

    async def on_status(evt):
        events.append(evt)

    llm = _ScriptedLLM([
        LLMResponse(
            text="",
            tool_calls=[
                ToolCall(id="a", name="get_candidates", arguments={}),
                ToolCall(id="b", name="get_ui_state", arguments={}),
            ],
            stop_reason="tool_use",
        ),
        LLMResponse(text="done"),
    ])
    svc = ChatService(db, llm)
    await svc.handle_message(role.id, "query", on_tool_status=on_status)

    statuses = [(e["tool_name"], e["status"]) for e in events]
    # Each tool fires both executing + complete
    assert statuses.count(("get_candidates", "executing")) == 1
    assert statuses.count(("get_candidates", "complete")) == 1
    assert statuses.count(("get_ui_state", "complete")) == 1


def test_clear_history_removes_messages(db, role):
    db.add(ChatMessage(role_id=role.id, role_enum="user", content="x"))
    db.add(ChatMessage(role_id=role.id, role_enum="assistant", content="y"))
    db.commit()
    svc = ChatService(db, _ScriptedLLM([]))
    n = svc.clear_history(role.id)
    assert n == 2
    assert svc.load_history(role.id) == []


def test_summarize_handles_known_tools():
    assert "candidates" in _summarize("get_candidates", {"returned": 3, "total": 5})
    assert "matches" in _summarize("search_candidates", {"match_count": 2})
    assert "Computed" in _summarize("compute_stats", {"stat_type": "count", "field": "skills"})
    assert "Detail" in _summarize("get_candidate_detail", {"name": "Ada"})
    assert "Scores" in _summarize("get_candidate_scores", {"name": "Ada"})
    assert "Raw text" in _summarize("get_candidate_raw_text", {"id": "x"})
    assert "UI state" in _summarize("get_ui_state", {})
    assert "error" in _summarize("get_candidates", {"error": "x"})
    assert _summarize("unknown_tool", {}) == "unknown_tool: ok"
    assert _summarize("anything", "raw string") == "anything: ok"


@pytest.mark.asyncio
async def test_history_round_trip_includes_prior_user_messages(db, role):
    """A second message in the same role sees the first user/assistant pair."""
    llm = _ScriptedLLM([LLMResponse(text="hi"), LLMResponse(text="again")])
    svc = ChatService(db, llm)
    await svc.handle_message(role.id, "first")
    await svc.handle_message(role.id, "second")
    second_call_messages = llm.calls[1]["messages"]
    contents = [(m.role, m.content) for m in second_call_messages]
    assert contents[0] == ("user", "first")
    assert contents[1] == ("assistant", "hi")
    assert contents[-1] == ("user", "second")
