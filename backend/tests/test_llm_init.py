import pytest
from fastapi import HTTPException

from app import llm as llm_module
from app.llm import get_llm_provider


@pytest.fixture(autouse=True)
def _clear_cache():
    llm_module._build_provider.cache_clear()
    yield
    llm_module._build_provider.cache_clear()


def test_get_llm_provider_translates_runtime_error_to_503(monkeypatch):
    def boom():
        raise RuntimeError("missing key")

    monkeypatch.setattr(llm_module, "_build_provider", boom)
    with pytest.raises(HTTPException) as exc:
        get_llm_provider()
    assert exc.value.status_code == 503


def test_get_llm_provider_returns_provider_when_available(monkeypatch):
    sentinel = object()
    monkeypatch.setattr(llm_module, "_build_provider", lambda: sentinel)
    assert get_llm_provider() is sentinel
