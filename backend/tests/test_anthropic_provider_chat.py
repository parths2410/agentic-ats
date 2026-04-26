"""Tests for AnthropicProvider.chat() — the single-turn agentic call."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.llm.anthropic_provider import AnthropicProvider
from app.llm.types import LLMMessage, ToolCall


def _make_provider(message):
    p = AnthropicProvider(api_key="fake")
    p._client = SimpleNamespace(
        messages=SimpleNamespace(create=AsyncMock(return_value=message))
    )
    return p


def _text_block(text):
    return SimpleNamespace(type="text", text=text)


def _tool_block(id, name, input):
    return SimpleNamespace(type="tool_use", id=id, name=name, input=input)


@pytest.mark.asyncio
async def test_chat_text_only_response_parsed():
    msg = SimpleNamespace(content=[_text_block("hello")], stop_reason="end_turn")
    p = _make_provider(msg)
    out = await p.chat(messages=[LLMMessage(role="user", content="hi")], tools=[], system_prompt="x")
    assert out.text == "hello"
    assert out.tool_calls == []
    assert out.stop_reason == "end_turn"


@pytest.mark.asyncio
async def test_chat_tool_use_blocks_become_tool_calls():
    msg = SimpleNamespace(
        content=[
            _text_block("looking it up"),
            _tool_block("call_1", "search_candidates", {"field": "skills", "query": "Python"}),
        ],
        stop_reason="tool_use",
    )
    p = _make_provider(msg)
    out = await p.chat(messages=[LLMMessage(role="user", content="find pythonistas")], tools=[{"name": "x"}], system_prompt="s")
    assert out.has_tool_calls
    assert out.tool_calls[0].name == "search_candidates"
    assert out.tool_calls[0].arguments == {"field": "skills", "query": "Python"}


@pytest.mark.asyncio
async def test_chat_serializes_history_with_tool_calls_and_results():
    msg = SimpleNamespace(content=[_text_block("done")], stop_reason="end_turn")
    p = _make_provider(msg)
    history = [
        LLMMessage(role="user", content="who is top?"),
        LLMMessage(
            role="assistant",
            content="checking",
            tool_calls=[ToolCall(id="t1", name="get_candidates", arguments={"limit": 1})],
        ),
        LLMMessage(role="tool", tool_call_id="t1", content={"top": "Ada"}),
    ]
    out = await p.chat(messages=history, tools=[], system_prompt="s")
    assert out.text == "done"

    # Inspect the call we made — assistant block must contain text + tool_use,
    # tool result must be a user message with a tool_result block.
    sent = p._client.messages.create.await_args.kwargs["messages"]
    roles = [m["role"] for m in sent]
    assert roles == ["user", "assistant", "user"]
    asst_blocks = sent[1]["content"]
    assert any(b.get("type") == "text" for b in asst_blocks)
    assert any(b.get("type") == "tool_use" and b["id"] == "t1" for b in asst_blocks)
    tool_blocks = sent[2]["content"]
    assert tool_blocks[0]["type"] == "tool_result"
    assert tool_blocks[0]["tool_use_id"] == "t1"
    # JSON-serialized
    assert "Ada" in tool_blocks[0]["content"]


@pytest.mark.asyncio
async def test_chat_passes_string_tool_result_through():
    msg = SimpleNamespace(content=[_text_block("ok")], stop_reason="end_turn")
    p = _make_provider(msg)
    history = [LLMMessage(role="tool", tool_call_id="t", content="raw text")]
    await p.chat(messages=history, tools=[], system_prompt="s")
    sent = p._client.messages.create.await_args.kwargs["messages"]
    assert sent[0]["content"][0]["content"] == "raw text"


@pytest.mark.asyncio
async def test_chat_no_tools_passes_none():
    msg = SimpleNamespace(content=[_text_block("ok")], stop_reason="end_turn")
    p = _make_provider(msg)
    await p.chat(messages=[LLMMessage(role="user", content="hi")], tools=[], system_prompt="s")
    assert p._client.messages.create.await_args.kwargs["tools"] is None


@pytest.mark.asyncio
async def test_chat_response_with_only_tool_calls_has_empty_text():
    msg = SimpleNamespace(
        content=[_tool_block("x", "y", {})],
        stop_reason="tool_use",
    )
    p = _make_provider(msg)
    out = await p.chat(messages=[LLMMessage(role="user", content="hi")], tools=[{"name": "y"}], system_prompt="s")
    assert out.text == ""
    assert out.has_tool_calls


@pytest.mark.asyncio
async def test_chat_assistant_message_with_no_text_serializes_only_tool_use():
    msg = SimpleNamespace(content=[_text_block("ok")], stop_reason="end_turn")
    p = _make_provider(msg)
    history = [
        LLMMessage(role="user", content="hi"),
        LLMMessage(role="assistant", content="", tool_calls=[ToolCall(id="x", name="get_ui_state", arguments={})]),
        LLMMessage(role="tool", tool_call_id="x", content={"ok": True}),
    ]
    await p.chat(messages=history, tools=[], system_prompt="s")
    sent = p._client.messages.create.await_args.kwargs["messages"]
    asst_blocks = sent[1]["content"]
    assert all(b["type"] == "tool_use" for b in asst_blocks)
