"""Provider-agnostic types used by the chat loop.

Lives in `app.llm` because the LLMProvider ABC owns the contract; both
provider implementations and the ChatService consume these types.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolCall:
    """A single tool invocation requested by the model."""

    id: str            # provider-supplied call id (used to correlate the result)
    name: str
    arguments: dict[str, Any]


@dataclass
class LLMMessage:
    """A normalized chat-history entry.

    `role` is one of "user", "assistant", "tool".

    For tool results, set role="tool", `tool_call_id` to the call id this
    result corresponds to, and put the JSON-serializable result in `content`
    (we re-serialize to text when forwarding to the provider).
    """

    role: str
    content: Any = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_call_id: str | None = None


@dataclass
class LLMResponse:
    """A single LLM turn's output as the chat service consumes it."""

    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    stop_reason: str | None = None

    @property
    def has_tool_calls(self) -> bool:
        return bool(self.tool_calls)
