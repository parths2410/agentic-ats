"""Tool registry — single dispatch surface for the agentic chat loop.

The registry owns the mapping from tool name to executor function. Adding a
new tool means: (1) add a definition in `definitions.py`, (2) add an
executor in `data_tools.py` (or `action_tools.py` later), (3) register both
here.

`execute()` is purposefully a thin wrapper — the chat service handles the
loop, the registry just routes one call.
"""

from __future__ import annotations

from typing import Any, Callable

from sqlalchemy.orm import Session

from app.tools import action_tools, data_tools
from app.tools.definitions import all_definitions


class UnknownToolError(KeyError):
    """Raised when the LLM requests a tool name we don't expose."""


Executor = Callable[[Session, str, dict[str, Any]], dict[str, Any]]


_DEFAULT_EXECUTORS: dict[str, Executor] = {
    "get_candidates": data_tools.get_candidates,
    "get_candidate_detail": data_tools.get_candidate_detail,
    "get_candidate_raw_text": data_tools.get_candidate_raw_text,
    "get_candidate_scores": data_tools.get_candidate_scores,
    "search_candidates": data_tools.search_candidates,
    "compute_stats": data_tools.compute_stats,
    "get_ui_state": data_tools.get_ui_state,
    # Action tools — added in M4.
    "set_highlights": action_tools.set_highlights,
    "remove_highlights": action_tools.remove_highlights,
    "clear_highlights": action_tools.clear_highlights,
    "set_sort": action_tools.set_sort,
    "reset_ui": action_tools.reset_ui,
}


class ToolRegistry:
    def __init__(
        self,
        executors: dict[str, Executor] | None = None,
        definitions: list[dict[str, Any]] | None = None,
    ) -> None:
        self._executors: dict[str, Executor] = dict(executors or _DEFAULT_EXECUTORS)
        self._definitions: list[dict[str, Any]] = list(definitions or all_definitions())

    def definitions(self) -> list[dict[str, Any]]:
        return list(self._definitions)

    def names(self) -> list[str]:
        return [d["name"] for d in self._definitions]

    def register(self, definition: dict[str, Any], executor: Executor) -> None:
        self._definitions.append(definition)
        self._executors[definition["name"]] = executor

    def execute(
        self, name: str, args: dict[str, Any], db: Session, role_id: str
    ) -> dict[str, Any]:
        try:
            fn = self._executors[name]
        except KeyError as e:
            raise UnknownToolError(name) from e
        return fn(db, role_id, args or {})


def default_registry() -> ToolRegistry:
    return ToolRegistry()
