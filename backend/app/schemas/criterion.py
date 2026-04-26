from pydantic import BaseModel, ConfigDict, Field


class CriterionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = ""
    weight: float = Field(default=1.0, ge=0.0, le=10.0)
    source: str = Field(default="manual", pattern="^(auto|manual)$")
    order_index: int | None = None


class CriterionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    weight: float | None = Field(default=None, ge=0.0, le=10.0)
    order_index: int | None = None


class CriterionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    role_id: str
    name: str
    description: str
    weight: float
    source: str
    order_index: int


class CriterionProposal(BaseModel):
    """Shape returned by the LLM extraction call (pre-persistence)."""

    name: str
    description: str
    weight: float
    source: str = "auto"


class CriteriaExtractionResponse(BaseModel):
    proposals: list[CriterionProposal]
