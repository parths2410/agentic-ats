"""Unit tests for AnthropicProvider — the Anthropic SDK is mocked."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.llm.anthropic_provider import (
    AnthropicProvider,
    LLMResponseError,
    _extract_json_object,
)


def _text_message(text: str, stop_reason: str = "end_turn"):
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)],
        stop_reason=stop_reason,
    )


def _patched_provider(message):
    p = AnthropicProvider(api_key="fake")
    p._client = SimpleNamespace(
        messages=SimpleNamespace(create=AsyncMock(return_value=message))
    )
    return p


def test_constructor_requires_api_key(monkeypatch):
    monkeypatch.setattr("app.llm.anthropic_provider.settings.anthropic_api_key", "")
    with pytest.raises(RuntimeError):
        AnthropicProvider()


def test_extract_json_object_handles_fences():
    fenced = "Here is data:\n```json\n{\"x\": 1}\n```\nthanks."
    assert _extract_json_object(fenced).strip() == "{\"x\": 1}"


def test_extract_json_object_falls_back_to_first_brace():
    assert "x" in _extract_json_object('garbage {"x": 1} trailing')


def test_extract_json_object_returns_text_when_no_braces():
    assert _extract_json_object("nothing here") == "nothing here"


@pytest.mark.asyncio
async def test_extract_criteria_parses_list():
    msg = _text_message(
        '{"criteria": ['
        '{"name": "Python", "description": "py", "weight": 1.0},'
        '{"name": "Leadership", "description": "ld", "weight": 0.5}'
        ']}'
    )
    p = _patched_provider(msg)
    out = await p.extract_criteria("JD")
    assert {c.name for c in out} == {"Python", "Leadership"}


@pytest.mark.asyncio
async def test_extract_criteria_skips_invalid_items():
    msg = _text_message(
        '{"criteria": [{"name": "OK", "description": "d", "weight": 1.0}, "garbage", {"weight": "bad"}]}'
    )
    p = _patched_provider(msg)
    out = await p.extract_criteria("JD")
    assert [c.name for c in out] == ["OK"]


@pytest.mark.asyncio
async def test_extract_criteria_empty_jd_returns_empty():
    p = _patched_provider(_text_message(""))
    assert await p.extract_criteria("   ") == []


@pytest.mark.asyncio
async def test_extract_criteria_raises_on_empty_text():
    p = _patched_provider(_text_message(""))
    with pytest.raises(LLMResponseError):
        await p.extract_criteria("real JD")


@pytest.mark.asyncio
async def test_extract_criteria_raises_on_invalid_json():
    p = _patched_provider(_text_message("not json"))
    with pytest.raises(LLMResponseError):
        await p.extract_criteria("real JD")


@pytest.mark.asyncio
async def test_extract_criteria_rejects_non_list_payload():
    p = _patched_provider(_text_message('{"criteria": {"oops": true}}'))
    with pytest.raises(LLMResponseError):
        await p.extract_criteria("real JD")


@pytest.mark.asyncio
async def test_parse_resume_fills_defaults():
    msg = _text_message('{"name": "Jane"}')
    p = _patched_provider(msg)
    out = await p.parse_resume("text")
    assert out["name"] == "Jane"
    assert out["experiences"] == [] and out["skills"] == []


@pytest.mark.asyncio
async def test_parse_resume_empty_text_raises():
    p = _patched_provider(_text_message("{}"))
    with pytest.raises(LLMResponseError):
        await p.parse_resume("   ")


@pytest.mark.asyncio
async def test_parse_resume_rejects_non_object():
    p = _patched_provider(_text_message('["hi"]'))
    with pytest.raises(LLMResponseError):
        await p.parse_resume("text")


@pytest.mark.asyncio
async def test_score_candidate_clamps_scores():
    msg = _text_message(
        '{"scores": [{"criterion_name": "C1", "score": 99, "rationale": "r"},'
        '{"criterion_name": "C2", "score": -1, "rationale": "r"}],'
        '"overall_summary": "x"}'
    )
    p = _patched_provider(msg)
    out = await p.score_candidate({}, "JD", [{"name": "C1", "description": "d", "weight": 1.0}, {"name": "C2", "description": "d", "weight": 1.0}])
    assert out["scores"][0]["score"] == 10.0
    assert out["scores"][1]["score"] == 1.0
    assert out["overall_summary"] == "x"


@pytest.mark.asyncio
async def test_score_candidate_no_criteria_short_circuits():
    p = _patched_provider(_text_message("{}"))
    out = await p.score_candidate({}, "JD", [])
    assert out == {"scores": [], "overall_summary": ""}


@pytest.mark.asyncio
async def test_score_candidate_rejects_non_object():
    p = _patched_provider(_text_message('"unexpected"'))
    with pytest.raises(LLMResponseError):
        await p.score_candidate({}, "JD", [{"name": "C", "description": "d", "weight": 1.0}])


@pytest.mark.asyncio
async def test_score_candidate_missing_scores_raises():
    p = _patched_provider(_text_message('{"overall_summary": "x"}'))
    with pytest.raises(LLMResponseError):
        await p.score_candidate({}, "JD", [{"name": "C", "description": "d", "weight": 1.0}])


@pytest.mark.asyncio
async def test_score_candidate_skips_unparseable_score_entries():
    msg = _text_message(
        '{"scores": ['
        '{"criterion_name": "", "score": 5, "rationale": "r"},'
        '{"criterion_name": "OK", "score": "bad", "rationale": "r"},'
        '{"criterion_name": "Real", "score": 7, "rationale": "r"}'
        ']}'
    )
    p = _patched_provider(msg)
    out = await p.score_candidate({}, "JD", [{"name": "Real", "description": "d", "weight": 1.0}])
    assert [s["criterion_name"] for s in out["scores"]] == ["Real"]
