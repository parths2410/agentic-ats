"""Tests for the retry-with-backoff helper around the Anthropic SDK."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from anthropic import (
    APIConnectionError,
    APIStatusError,
    InternalServerError,
    RateLimitError,
)

from app.llm.anthropic_provider import AnthropicProvider, _with_retry


def _http_response(status: int) -> httpx.Response:
    return httpx.Response(status, request=httpx.Request("POST", "https://api"))


def _api_status_error(status: int) -> APIStatusError:
    """Build an APIStatusError without going through the SDK class init dance."""
    err = APIStatusError.__new__(APIStatusError)
    err.status_code = status
    err.message = f"http {status}"
    err.response = _http_response(status)
    return err


def _rate_limit_error() -> RateLimitError:
    err = RateLimitError.__new__(RateLimitError)
    err.status_code = 429
    err.message = "rate limited"
    err.response = _http_response(429)
    return err


def _internal_error() -> InternalServerError:
    err = InternalServerError.__new__(InternalServerError)
    err.status_code = 500
    err.message = "boom"
    err.response = _http_response(500)
    return err


def _connection_error() -> APIConnectionError:
    err = APIConnectionError.__new__(APIConnectionError)
    err.message = "conn"
    err.request = httpx.Request("POST", "https://api")
    return err


@pytest.mark.asyncio
async def test_retry_returns_on_first_success():
    op = AsyncMock(return_value="ok")
    out = await _with_retry(op, attempts=3, initial_delay=0)
    assert out == "ok"
    assert op.await_count == 1


@pytest.mark.asyncio
async def test_retry_recovers_after_rate_limit():
    op = AsyncMock(side_effect=[_rate_limit_error(), "ok"])
    out = await _with_retry(op, attempts=3, initial_delay=0)
    assert out == "ok"
    assert op.await_count == 2


@pytest.mark.asyncio
async def test_retry_gives_up_after_max_attempts():
    op = AsyncMock(side_effect=_rate_limit_error())
    with pytest.raises(RateLimitError):
        await _with_retry(op, attempts=2, initial_delay=0)
    assert op.await_count == 2


@pytest.mark.asyncio
async def test_retry_handles_connection_error():
    op = AsyncMock(side_effect=[_connection_error(), "ok"])
    out = await _with_retry(op, attempts=3, initial_delay=0)
    assert out == "ok"


@pytest.mark.asyncio
async def test_retry_handles_internal_server_error():
    op = AsyncMock(side_effect=[_internal_error(), "ok"])
    out = await _with_retry(op, attempts=3, initial_delay=0)
    assert out == "ok"


@pytest.mark.asyncio
async def test_retry_retries_5xx_api_status_error():
    op = AsyncMock(side_effect=[_api_status_error(503), "ok"])
    out = await _with_retry(op, attempts=3, initial_delay=0)
    assert out == "ok"


@pytest.mark.asyncio
async def test_retry_does_not_retry_4xx_api_status_error():
    err = _api_status_error(400)
    op = AsyncMock(side_effect=err)
    with pytest.raises(APIStatusError):
        await _with_retry(op, attempts=3, initial_delay=0)
    assert op.await_count == 1


@pytest.mark.asyncio
async def test_provider_extract_criteria_retries(monkeypatch):
    """Verify the retry wrapper plumbs through extract_criteria."""
    p = AnthropicProvider(api_key="fake")
    success_message = SimpleNamespace(
        content=[SimpleNamespace(type="text", text='{"criteria": [{"name": "C", "description": "d", "weight": 1.0}]}')],
        stop_reason="end_turn",
    )
    p._client = SimpleNamespace(
        messages=SimpleNamespace(create=AsyncMock(side_effect=[_rate_limit_error(), success_message]))
    )
    # Speed it up.
    monkeypatch.setattr("app.llm.anthropic_provider.asyncio.sleep", AsyncMock())
    out = await p.extract_criteria("JD")
    assert out[0].name == "C"
    assert p._client.messages.create.await_count == 2
