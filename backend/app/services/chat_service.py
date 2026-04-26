"""ChatService — owns the agentic tool-use loop.

Per the architecture (Section 2.3.5), this service drives the loop and is
provider-agnostic. The loop:

1. Load history from the chat_messages table.
2. Build a system prompt with role context.
3. Call provider.chat() with messages + tool definitions.
4. If the response has tool_calls, execute them (in parallel) via the
   ToolRegistry, append the results to the message list, and loop.
5. If the response is plain text, exit the loop.
6. Persist the user's prompt and the final assistant text to chat_messages.

UI-mutation handling (M4) will hook into step 4 to accumulate mutations from
action-tool calls; for now `ui_mutations` stays None.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.llm.base import LLMProvider
from app.llm.prompts.chat_system import build_system_prompt
from app.llm.types import LLMMessage, LLMResponse, ToolCall
from app.models.candidate import Candidate
from app.models.chat import ChatMessage
from app.models.criterion import Criterion
from app.models.role import Role
from app.tools.definitions import ACTION_TOOL_NAMES
from app.tools.registry import ToolRegistry, default_registry

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 5

class UIMutationsAccumulator:
    """Folds individual action-tool mutations into a single payload.

    Highlight semantics: `add` and `remove` are net sets — if the LLM
    highlights c1 then removes c1 in the same turn, c1 ends up in `remove`.
    Sort and reset are last-write-wins.
    """

    def __init__(self) -> None:
        self.add: list[str] = []
        self.remove: list[str] = []
        self._add_set: set[str] = set()
        self._remove_set: set[str] = set()
        self.sort_field: str | None = None
        self.sort_order: str | None = None
        self.cleared: bool = False
        self.reset: bool = False

    @property
    def has_changes(self) -> bool:
        return bool(
            self.add
            or self.remove
            or self.sort_field is not None
            or self.cleared
            or self.reset
        )

    def merge(self, mutation: dict[str, Any]) -> None:
        mtype = mutation.get("type")
        if mtype == "set_highlights":
            for cid in mutation.get("add") or []:
                cid = str(cid)
                if cid in self._remove_set:
                    self._remove_set.discard(cid)
                    self.remove = [c for c in self.remove if c != cid]
                if cid not in self._add_set:
                    self._add_set.add(cid)
                    self.add.append(cid)
            for cid in mutation.get("remove") or []:
                cid = str(cid)
                if cid in self._add_set:
                    self._add_set.discard(cid)
                    self.add = [c for c in self.add if c != cid]
                if cid not in self._remove_set:
                    self._remove_set.add(cid)
                    self.remove.append(cid)
        elif mtype == "clear_highlights":
            self.add = []
            self.remove = []
            self._add_set.clear()
            self._remove_set.clear()
            self.cleared = True
        elif mtype == "set_sort":
            self.sort_field = mutation.get("field")
            self.sort_order = mutation.get("order") or "desc"
        elif mtype == "reset_ui":
            self.add = []
            self.remove = []
            self._add_set.clear()
            self._remove_set.clear()
            self.sort_field = None
            self.sort_order = None
            self.reset = True
            self.cleared = False  # reset supersedes clear

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if self.reset:
            out["reset"] = True
        elif self.cleared:
            out["clear_highlights"] = True
        if self.add or self.remove:
            out["highlights"] = {"add": self.add, "remove": self.remove}
        if self.sort_field is not None:
            out["re_sort"] = {"field": self.sort_field, "order": self.sort_order or "desc"}
        return out


class RoleNotFound(Exception):
    pass


@dataclass
class ToolInvocation:
    iteration: int
    name: str
    arguments: dict[str, Any]
    result: Any
    summary: str | None = None


@dataclass
class ChatTurnResult:
    """In-process return for a single chat call. The API layer maps this to
    the wire schema in `app.schemas.chat`.
    """

    text: str
    invocations: list[ToolInvocation]
    ui_mutations: dict[str, Any] | None = None
    iterations: int = 0
    truncated: bool = False


class ChatService:
    def __init__(
        self,
        db: Session,
        llm: LLMProvider,
        registry: ToolRegistry | None = None,
        max_iterations: int = MAX_ITERATIONS,
    ) -> None:
        self.db = db
        self.llm = llm
        self.registry = registry or default_registry()
        self.max_iterations = max_iterations

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------

    def load_history(self, role_id: str) -> list[ChatMessage]:
        return list(
            self.db.execute(
                select(ChatMessage)
                .where(ChatMessage.role_id == role_id)
                .order_by(ChatMessage.created_at, ChatMessage.id)
            ).scalars()
        )

    def clear_history(self, role_id: str) -> int:
        rows = self.load_history(role_id)
        for r in rows:
            self.db.delete(r)
        self.db.commit()
        return len(rows)

    # ------------------------------------------------------------------
    # System prompt
    # ------------------------------------------------------------------

    def _build_system_prompt(self, role: Role) -> str:
        criteria = [
            {"name": c.name, "weight": c.weight, "description": c.description}
            for c in sorted(role.criteria, key=lambda c: (c.order_index, c.name))
        ]
        candidate_count = self.db.execute(
            select(Candidate.id).where(Candidate.role_id == role.id)
        ).all()
        return build_system_prompt(
            role_title=role.title,
            job_description=role.job_description,
            criteria=criteria,
            candidate_count=len(candidate_count),
        )

    # ------------------------------------------------------------------
    # Loop
    # ------------------------------------------------------------------

    async def handle_message(
        self,
        role_id: str,
        user_message: str,
        on_tool_status: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> ChatTurnResult:
        role = self.db.get(Role, role_id)
        if role is None:
            raise RoleNotFound(role_id)

        # Persist the user message immediately so the history reflects it
        # even if the assistant turn fails partway.
        self.db.add(ChatMessage(role_id=role_id, role_enum="user", content=user_message))
        self.db.commit()

        history = self._history_to_llm(self.load_history(role_id))
        system_prompt = self._build_system_prompt(role)
        tool_definitions = self.registry.definitions()

        invocations: list[ToolInvocation] = []
        mutations = UIMutationsAccumulator()
        truncated = False
        last_response: LLMResponse | None = None
        iterations = 0

        for iteration in range(1, self.max_iterations + 1):
            iterations = iteration
            response = await self.llm.chat(
                messages=history,
                tools=tool_definitions,
                system_prompt=system_prompt,
            )
            last_response = response

            if not response.has_tool_calls:
                break

            # Append the assistant's tool-use turn to history.
            history.append(
                LLMMessage(
                    role="assistant",
                    content=response.text,
                    tool_calls=response.tool_calls,
                )
            )

            results = await self._execute_calls(
                role_id, response.tool_calls, on_tool_status, iteration
            )
            for call, (result, summary) in zip(response.tool_calls, results):
                invocations.append(
                    ToolInvocation(
                        iteration=iteration,
                        name=call.name,
                        arguments=call.arguments,
                        result=result,
                        summary=summary,
                    )
                )
                if (
                    call.name in ACTION_TOOL_NAMES
                    and isinstance(result, dict)
                    and isinstance(result.get("mutation"), dict)
                ):
                    mutations.merge(result["mutation"])
                history.append(
                    LLMMessage(
                        role="tool",
                        tool_call_id=call.id,
                        content=result,
                    )
                )

            if iteration == self.max_iterations:
                truncated = True
                break

        final_text = (last_response.text if last_response else "").strip() or (
            "(no response — the assistant ran out of iterations before finishing.)"
            if truncated
            else ""
        )

        ui_mutations_payload = mutations.to_dict() if mutations.has_changes else None

        # Persist assistant message.
        self.db.add(
            ChatMessage(
                role_id=role_id,
                role_enum="assistant",
                content=final_text,
                ui_mutations=ui_mutations_payload,
            )
        )
        self.db.commit()

        return ChatTurnResult(
            text=final_text,
            invocations=invocations,
            ui_mutations=ui_mutations_payload,
            iterations=iterations,
            truncated=truncated,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _history_to_llm(rows: list[ChatMessage]) -> list[LLMMessage]:
        out: list[LLMMessage] = []
        for r in rows:
            if r.role_enum not in ("user", "assistant"):
                continue
            out.append(LLMMessage(role=r.role_enum, content=r.content))
        return out

    async def _execute_calls(
        self,
        role_id: str,
        calls: list[ToolCall],
        on_tool_status: Callable[[dict[str, Any]], Awaitable[None]] | None,
        iteration: int,
    ) -> list[tuple[Any, str | None]]:
        # Serialize tool execution: action tools mutate UI state via the
        # shared session, and parallel writers would race on commit. Tool
        # calls are short, so the parallelism savings aren't worth the
        # session-management cost.
        results: list[tuple[Any, str | None]] = []
        for call in calls:
            if on_tool_status:
                await on_tool_status({
                    "type": "tool_status",
                    "iteration": iteration,
                    "tool_name": call.name,
                    "status": "executing",
                })
            try:
                result = await asyncio.to_thread(
                    self.registry.execute, call.name, call.arguments, self.db, role_id
                )
            except Exception as e:  # tool errors are returned to the LLM
                logger.exception("Tool %s failed", call.name)
                result = {"error": f"tool execution failed: {e}"}
            summary = _summarize(call.name, result)
            if on_tool_status:
                await on_tool_status({
                    "type": "tool_status",
                    "iteration": iteration,
                    "tool_name": call.name,
                    "status": "complete",
                    "summary": summary,
                })
            results.append((result, summary))
        return results


def _summarize(name: str, result: Any) -> str:
    """Tiny human-readable summary of a tool result for UI tool_status events."""
    if isinstance(result, dict):
        if "error" in result:
            return f"{name}: error"
        if name == "get_candidates":
            return f"Returned {result.get('returned', 0)} of {result.get('total', 0)} candidates"
        if name == "search_candidates":
            return f"Found {result.get('match_count', 0)} matches"
        if name == "compute_stats":
            return f"Computed {result.get('stat_type', 'stat')} on {result.get('field', '?')}"
        if name == "get_candidate_detail":
            return f"Detail for {result.get('name') or result.get('id', 'candidate')}"
        if name == "get_candidate_scores":
            return f"Scores for {result.get('name') or result.get('id', 'candidate')}"
        if name == "get_candidate_raw_text":
            return f"Raw text for {result.get('name') or result.get('id', 'candidate')}"
        if name == "get_ui_state":
            return "Read UI state"
    return f"{name}: ok"
