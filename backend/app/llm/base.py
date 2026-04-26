from abc import ABC, abstractmethod
from typing import Any

from app.llm.types import LLMMessage, LLMResponse
from app.schemas.criterion import CriterionProposal


class LLMProvider(ABC):
    """Interface for swappable LLM providers."""

    @abstractmethod
    async def extract_criteria(self, job_description: str) -> list[CriterionProposal]:
        """Propose scoring criteria from a job description."""
        ...

    @abstractmethod
    async def parse_resume(self, raw_text: str) -> dict[str, Any]:
        """Parse a resume's raw text into a StructuredProfile dict."""
        ...

    @abstractmethod
    async def score_candidate(
        self,
        profile: dict[str, Any],
        job_description: str,
        criteria: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Score a candidate against criteria.

        Returns {"scores": [{criterion_name, score, rationale}, ...], "overall_summary": str}.
        """
        ...

    @abstractmethod
    async def chat(
        self,
        messages: list[LLMMessage],
        tools: list[dict[str, Any]],
        system_prompt: str,
    ) -> LLMResponse:
        """One agentic-loop turn: send messages + tool defs, get text and/or tool calls.

        Implementations map this to their native tool-use API. The loop lives
        in ChatService — this method MUST NOT loop on its own.
        """
        ...
