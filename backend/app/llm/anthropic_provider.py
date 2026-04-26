import json
import re
from typing import Any

from anthropic import AsyncAnthropic
from pydantic import ValidationError

from app.config import settings
from app.llm.base import LLMProvider
from app.llm.prompts.extract_criteria import (
    SYSTEM_PROMPT as EXTRACT_CRITERIA_SYSTEM,
    build_user_prompt as build_extract_criteria_user_prompt,
)
from app.llm.prompts.parse_resume import (
    SYSTEM_PROMPT as PARSE_RESUME_SYSTEM,
    build_user_prompt as build_parse_resume_user_prompt,
)
from app.llm.prompts.score_candidate import (
    SYSTEM_PROMPT as SCORE_CANDIDATE_SYSTEM,
    build_user_prompt as build_score_candidate_user_prompt,
)
from app.llm.types import LLMMessage, LLMResponse, ToolCall
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

    async def _call_json(self, system: str, user: str, max_tokens: int = 4096) -> Any:
        message = await self._client.messages.create(
            model=self._model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        text_parts = [
            block.text for block in message.content if getattr(block, "type", None) == "text"
        ]
        raw = "".join(text_parts).strip()
        if not raw:
            raise LLMResponseError(
                f"Empty response from LLM (stop_reason={message.stop_reason})."
            )
        json_str = _extract_json_object(raw)
        try:
            return json.loads(json_str)
        except json.JSONDecodeError as e:
            raise LLMResponseError(
                f"LLM did not return valid JSON (stop_reason={message.stop_reason}): {e}\n"
                f"Raw: {raw[:500]}"
            ) from e

    async def parse_resume(self, raw_text: str) -> dict[str, Any]:
        if not raw_text.strip():
            raise LLMResponseError("Resume text is empty; cannot parse.")
        payload = await self._call_json(
            PARSE_RESUME_SYSTEM, build_parse_resume_user_prompt(raw_text), max_tokens=4096
        )
        if not isinstance(payload, dict):
            raise LLMResponseError(
                f"Expected resume profile object; got {type(payload).__name__}."
            )
        # Defensive defaults so downstream code can rely on shape.
        payload.setdefault("name", None)
        payload.setdefault("contact_info", {})
        payload.setdefault("summary", None)
        payload.setdefault("experiences", [])
        payload.setdefault("education", [])
        payload.setdefault("skills", [])
        payload.setdefault("certifications", [])
        payload.setdefault("confidence_scores", {})
        return payload

    async def score_candidate(
        self,
        profile: dict[str, Any],
        job_description: str,
        criteria: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not criteria:
            return {"scores": [], "overall_summary": ""}
        payload = await self._call_json(
            SCORE_CANDIDATE_SYSTEM,
            build_score_candidate_user_prompt(job_description, criteria, profile),
            max_tokens=4096,
        )
        if not isinstance(payload, dict):
            raise LLMResponseError(
                f"Expected scoring object; got {type(payload).__name__}."
            )
        scores = payload.get("scores")
        if not isinstance(scores, list):
            raise LLMResponseError("Scoring response missing 'scores' list.")
        cleaned: list[dict[str, Any]] = []
        for item in scores:
            if not isinstance(item, dict):
                continue
            name = str(item.get("criterion_name", "")).strip()
            if not name:
                continue
            try:
                score_val = float(item.get("score", 0))
            except (TypeError, ValueError):
                continue
            score_val = max(1.0, min(10.0, score_val))
            cleaned.append(
                {
                    "criterion_name": name,
                    "score": score_val,
                    "rationale": str(item.get("rationale", "")).strip(),
                }
            )
        return {
            "scores": cleaned,
            "overall_summary": str(payload.get("overall_summary", "")).strip(),
        }

    # ------------------------------------------------------------------
    # chat() — single agentic turn (used by ChatService loop)
    # ------------------------------------------------------------------

    async def chat(
        self,
        messages: list[LLMMessage],
        tools: list[dict[str, Any]],
        system_prompt: str,
    ) -> LLMResponse:
        anthropic_messages = self._to_anthropic_messages(messages)
        message = await self._client.messages.create(
            model=self._model,
            max_tokens=2048,
            system=system_prompt,
            tools=tools or None,
            messages=anthropic_messages,
        )
        return self._parse_chat_response(message)

    @staticmethod
    def _to_anthropic_messages(messages: list[LLMMessage]) -> list[dict[str, Any]]:
        """Convert our normalized history into the wire format Anthropic expects."""
        out: list[dict[str, Any]] = []
        for m in messages:
            if m.role == "user":
                out.append({"role": "user", "content": str(m.content or "")})
            elif m.role == "assistant":
                blocks: list[dict[str, Any]] = []
                if m.content:
                    blocks.append({"type": "text", "text": str(m.content)})
                for call in m.tool_calls:
                    blocks.append({
                        "type": "tool_use",
                        "id": call.id,
                        "name": call.name,
                        "input": call.arguments,
                    })
                out.append({"role": "assistant", "content": blocks})
            elif m.role == "tool":
                # Tool results are sent as user messages with a tool_result block.
                serialized = (
                    m.content if isinstance(m.content, str) else json.dumps(m.content, default=str)
                )
                out.append({
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": m.tool_call_id or "",
                            "content": serialized,
                        }
                    ],
                })
        return out

    @staticmethod
    def _parse_chat_response(message: Any) -> LLMResponse:
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for block in getattr(message, "content", []) or []:
            block_type = getattr(block, "type", None)
            if block_type == "text":
                text_parts.append(getattr(block, "text", "") or "")
            elif block_type == "tool_use":
                tool_calls.append(
                    ToolCall(
                        id=getattr(block, "id", ""),
                        name=getattr(block, "name", ""),
                        arguments=dict(getattr(block, "input", {}) or {}),
                    )
                )
        return LLMResponse(
            text="".join(text_parts).strip(),
            tool_calls=tool_calls,
            stop_reason=getattr(message, "stop_reason", None),
        )
