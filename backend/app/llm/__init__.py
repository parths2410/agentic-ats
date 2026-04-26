from functools import lru_cache

from fastapi import HTTPException

from app.llm.anthropic_provider import AnthropicProvider
from app.llm.base import LLMProvider


@lru_cache(maxsize=1)
def _build_provider() -> LLMProvider:
    return AnthropicProvider()


def get_llm_provider() -> LLMProvider:
    try:
        return _build_provider()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
