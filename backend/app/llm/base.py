from abc import ABC, abstractmethod

from app.schemas.criterion import CriterionProposal


class LLMProvider(ABC):
    """Interface for swappable LLM providers.

    Only methods needed by the current milestone are required. Future milestones
    will add parse_resume, score_candidate, and chat (single-turn).
    """

    @abstractmethod
    async def extract_criteria(self, job_description: str) -> list[CriterionProposal]:
        """Propose scoring criteria from a job description."""
        ...
