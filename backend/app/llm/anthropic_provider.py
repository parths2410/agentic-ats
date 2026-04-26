import json
import re

from anthropic import AsyncAnthropic
from pydantic import ValidationError

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.prompts.extract_criteria import (
    SYSTEM_PROMPT as EXTRACT_CRITERIA_SYSTEM,
    build_user_prompt as build_extract_criteria_user_prompt,
)
from app.schemas.criterion import CriterionProposal


class LLMResponseError(Exception):
    """Raised when an LLM response cannot be parsed into the expected shape."""


_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def _extract_json_object(text: str) -> str:
    """Pull a JSON object out of a model response, tolerating code fences and prose."""
    fence_match = _JSON_FENCE_RE.search(text)
    if fence_match:
        return fence_match.group(1).strip()

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start : end + 1]

    return text.strip()


class AnthropicProvider(LLMProvider):
    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        key = api_key or settings.anthropic_api_key
        if not key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set. Add it to backend/.env or the environment."
            )
        self._client = AsyncAnthropic(api_key=key)
        self._model = model or settings.llm_model

    async def extract_criteria(self, job_description: str) -> list[CriterionProposal]:
        if not job_description.strip():
            return []

        message = await self._client.messages.create(
            model=self._model,
            max_tokens=2048,
            system=EXTRACT_CRITERIA_SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": build_extract_criteria_user_prompt(job_description),
                }
            ],
        )

        text_parts = [block.text for block in message.content if getattr(block, "type", None) == "text"]
        raw = "".join(text_parts).strip()
        if not raw:
            raise LLMResponseError("Empty response from LLM.")

        json_str = _extract_json_object(raw)
        try:
            payload = json.loads(json_str)
        except json.JSONDecodeError as e:
            raise LLMResponseError(f"LLM did not return valid JSON: {e}\nRaw: {raw[:500]}") from e

        items = payload.get("criteria") if isinstance(payload, dict) else payload
        if not isinstance(items, list):
            raise LLMResponseError(
                f"Expected a list of criteria; got {type(items).__name__}. Raw: {raw[:500]}"
            )

        proposals: list[CriterionProposal] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                proposals.append(
                    CriterionProposal(
                        name=str(item.get("name", "")).strip(),
                        description=str(item.get("description", "")).strip(),
                        weight=float(item.get("weight", 1.0)),
                        source="auto",
                    )
                )
            except (ValidationError, ValueError, TypeError):
                continue

        return [p for p in proposals if p.name]
