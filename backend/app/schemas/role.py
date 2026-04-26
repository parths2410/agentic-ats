from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class RoleCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    job_description: str = ""


class RoleUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    job_description: str | None = None


class RoleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    job_description: str
    created_at: datetime
    updated_at: datetime


class RoleSummary(BaseModel):
    """Role with lightweight aggregates for list views."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    candidate_count: int = 0
    criteria_count: int = 0
