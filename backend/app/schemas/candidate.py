from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class CriterionScoreRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    criterion_id: str
    criterion_name: str
    weight: float
    score: float
    rationale: str


class CandidateSummary(BaseModel):
    """Lightweight ranked-list view."""

    id: str
    role_id: str
    name: str | None
    pdf_filename: str | None
    aggregate_score: float | None
    rank: int | None
    status: str
    error_message: str | None
    created_at: datetime
    scores: list[CriterionScoreRead] = []


class CandidateDetail(CandidateSummary):
    raw_text: str
    structured_profile: dict[str, Any] | None
    parse_confidence: dict[str, Any] | None


class UploadResponse(BaseModel):
    candidates: list[CandidateSummary]
