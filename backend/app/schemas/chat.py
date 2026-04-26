from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ChatMessageRead(BaseModel):
    """One persisted message (user, assistant, or tool call/result entry)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    role_id: str
    role_enum: str  # "user" | "assistant"
    content: str
    ui_mutations: dict[str, Any] | None = None
    created_at: datetime


class ChatHistory(BaseModel):
    messages: list[ChatMessageRead]


class ToolCallTrace(BaseModel):
    """Per-iteration trace surfaced to the UI for transparency."""

    iteration: int
    name: str
    arguments: dict[str, Any]
    summary: str | None = None


class ChatResponse(BaseModel):
    text: str
    tool_trace: list[ToolCallTrace] = Field(default_factory=list)
    ui_mutations: dict[str, Any] | None = None
