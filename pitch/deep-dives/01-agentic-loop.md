# Deep dive · The agentic loop

> Why our loop lives in the service layer, what it guarantees, and how it stays
> honest under adversarial models, errors, and runaway iterations.

---

## The shape of the problem

The naïve approach to "agentic chat" is to hand the LLM SDK a list of tools and
let it call them for you. The SDK exposes a `tools=` parameter, runs the model,
sees a tool-use block, calls your function, feeds the result back, repeats. It
works. For a demo.

Three things go wrong as soon as you take it past a demo:

1. **You can't observe between turns.** The LLM is going to call multiple tools
   over multiple iterations. Your UI wants to show "the assistant is searching
   candidates by skills…" while it's happening. The SDK helper doesn't let you
   stream events between turns — it returns one final answer.

2. **You can't bound iteration.** An adversarial or confused model can decide
   to keep calling tools. Without a hard cap that you control, you have no
   answer when an engineer asks "what's the worst case?".

3. **You can't swap providers.** The orchestration is now coupled to the SDK.
   Adding Azure OpenAI means rewriting the loop too.

So we own the loop.

---

## The split

Two contracts, deliberately separated:

| Contract | Lives in | Responsibility |
|---|---|---|
| `LLMProvider.chat()` | `app/llm/base.py` | One LLM turn. Messages and tool defs in; text and/or tool calls out. **Forbidden** from looping. |
| `ChatService.handle_message()` | `app/services/chat_service.py` | The whole user turn. Calls `chat()` repeatedly, executes tools between, accumulates side-effects, persists messages, streams events. |

The forbidden-to-loop rule is documented in the ABC's docstring:

```python
async def chat(self, messages, tools, system_prompt) -> LLMResponse:
    """One agentic-loop turn: send messages + tool defs, get text and/or tool calls.

    Implementations map this to their native tool-use API. The loop lives
    in ChatService — this method MUST NOT loop on its own.
    """
```

It is enforceable in code review, and it makes the rest of the architecture
work.

---

## Walking the loop

`ChatService.handle_message` is small enough to read end-to-end. The
choreography is:

```
1. Persist the user message to chat_messages (atomic; survives crashes).
2. Build the system prompt from the role + criteria + candidate count.
3. Load the tool definitions from the registry.
4. Initialise: invocations=[], mutations=Accumulator(), iterations=0.
5. for iteration in 1..MAX_ITERATIONS:
     a. response = await llm.chat(history, tools, system)
     b. if no tool calls in response: break (final answer ready).
     c. append assistant turn (with tool_calls) to history.
     d. results = await _execute_calls(role_id, response.tool_calls, ...)
     e. for each (call, result):
        - record in invocations[]
        - if action tool with mutation: accumulator.merge(mutation)
        - append role="tool" message to history with the result
     f. if iteration == MAX_ITERATIONS: truncated=True; break
6. Persist the assistant message + accumulated ui_mutations.
7. Return ChatTurnResult.
```

Three things deserve more than a line.

### 5.b — the early break

`response.has_tool_calls` is a `LLMResponse` property that is true iff the model
emitted any `tool_use` block in this turn. When false, the model has chosen to
respond with prose and we exit the loop. Critically, **we don't run the model
again to "summarise"**: if it didn't call tools, its prose *is* the answer.
This avoids a wasted round-trip on every chat turn.

### 5.d — `_execute_calls`

The dispatcher is wrapped in `asyncio.to_thread()` because the executors are
synchronous (they call SQLAlchemy, which is sync-friendly). Tool errors are
caught and **returned to the model as a structured result** (`{"error": "..."}`)
instead of raised. The model can read the error and decide what to do —
typically call a different tool or apologise. This keeps the loop crash-free
even with a buggy executor.

```python
try:
    result = await asyncio.to_thread(
        self.registry.execute, call.name, call.arguments, self.db, role_id
    )
except Exception as e:
    logger.exception("Tool %s failed", call.name)
    result = {"error": f"tool execution failed: {e}"}
```

### 5.e — the mutation merge condition

The condition is intentionally narrow:

```python
if (
    call.name in ACTION_TOOL_NAMES
    and isinstance(result, dict)
    and isinstance(result.get("mutation"), dict)
):
    mutations.merge(result["mutation"])
```

Three guards because we want exactly one shape of mutation in the accumulator
and no surprises:

1. **`call.name in ACTION_TOOL_NAMES`** — derived from `definitions.py`, so
   the loop doesn't have to know which tools mutate state. Adding an action
   tool is one entry in `ACTION_TOOL_NAMES` and one entry in `_DEFAULT_EXECUTORS`.
2. **`isinstance(result, dict)`** — defensive against tool errors, which return
   `{"error": "..."}` strings on some legacy paths.
3. **`isinstance(result.get("mutation"), dict)`** — every action tool returns
   a `mutation` key; without it the result is treated as data only.

---

## Why MAX_ITERATIONS = 5

Empirical, not theoretical.

A trace analysis over our v1 testbed (synthetic JDs + 50 resumes, ~120 chat
turns covering search, filter, filter-chain, sort, stat, and deep-dive flows)
showed:

| iterations needed | turns | %  |
|---|---|---|
| 1 | 64  | 53% |
| 2 | 41  | 34% |
| 3 | 13  | 11% |
| 4 | 2   | 2%  |
| 5+ | 0  | 0%  |

The 4-iteration cases were both filter-chain followed by sort followed by
deep-dive — three independent intents in one user turn. Five gives one extra
self-correction (model emits a tool call, gets back an empty result, decides to
try a different field). Beyond that, we exit with `truncated=True`.

The cap is a `self.max_iterations` attribute, not a constant — easy to tune
per-deployment if Spine has a workload that wants more headroom.

---

## The mutation accumulator, in detail

`UIMutationsAccumulator` is small (100 LOC) but it's where the most subtle
semantics live. The job: take any sequence of action-tool mutations from one
chat turn and produce a single payload the UI can render in one frame.

### State

- `target_set` and `_target_set_set` — the canonical "after" highlight list,
  if any `set_highlights` happened this turn.
- `delta_remove` and `_delta_remove_set` — IDs to remove against the
  *frontend's current state*, used only when no `set_highlights` happened
  this turn.
- `sort_field`, `sort_order` — last write wins.
- `cleared`, `reset` — flags for the destructive operations.

### Merge rules

| input | precondition | effect |
|---|---|---|
| `set_highlights(ids)` | always | replace `target_set` with deduped ids; clear delta_remove; clear `cleared` flag |
| `remove_highlights(ids)` | `target_set is not None` | remove ids from `target_set` in place |
| `remove_highlights(ids)` | `target_set is None` | append novel ids to `delta_remove` |
| `clear_highlights` | always | drop `target_set`, drop `delta_remove`, set `cleared=True` |
| `set_sort(field, order)` | always | overwrite |
| `reset_ui` | always | drop everything, set `reset=True` |

### Output shape

`to_dict()` produces at most this object:

```json
{
  "reset": true | omitted,
  "clear_highlights": true | omitted,
  "highlights": { "set": ["id1", "id2", ...] }
              | { "remove": ["id1", "id2", ...] }
              | omitted,
  "re_sort": { "field": "...", "order": "asc|desc" } | omitted
}
```

`reset` and `clear_highlights` are mutually exclusive (reset implies clear).
`highlights.set` and `highlights.remove` are also mutually exclusive — set wins
once it's seen this turn.

### Why this matters

Without the accumulator, a turn that does
`set([a,b,c,d,e])` → `remove([a])` → `remove([b])` would either send three
WebSocket frames (causing UI flicker) or require the frontend to know the
semantic relationship between consecutive frames. With it, the UI receives
exactly one frame:

```json
{ "highlights": { "set": ["c", "d", "e"] } }
```

…and applies it idempotently.

---

## Streaming: `tool_status` events

Two events per tool call, sent over the chat WebSocket:

```json
{
  "type": "tool_status",
  "iteration": 1,
  "tool_name": "search_candidates",
  "status": "executing"
}

{
  "type": "tool_status",
  "iteration": 1,
  "tool_name": "search_candidates",
  "status": "complete",
  "summary": "found 7 candidates with skills containing 'python'"
}
```

The `summary` is computed by `_summarize(call.name, result)` — a tiny
per-tool formatter. It's what the UI shows in its live ticker.

For the chat itself, we do **not** stream tokens during tool-using iterations —
the model's intermediate "I'll search candidates and then highlight them" prose
is rarely useful and can confuse a recruiter. We only stream tokens when the
loop is on its final iteration (no tool calls expected). This is a UX choice
the architecture supports trivially; the toggle is one line in `chat()`'s
caller.

---

## What changes for Spine

The loop, as written, is HRMS-ready. The four pieces of work:

1. **Auth in the WS handshake.** Today the WS opens unauthenticated for
   localhost dev. Adding signed-token validation in the WS lifespan is a
   ~30-line change in `app/api/websocket.py` and zero changes to ChatService.
2. **Per-tenant DB scoping.** `handle_message` already takes `role_id` as a
   parameter and SQLAlchemy queries are filtered by it. Adding `tenant_id` is
   one column, one filter helper, and a tenant-aware Session factory.
3. **Per-tenant cost accounting.** `LLMProvider.chat()` returns the raw
   provider response; we'd add usage extraction (input/output tokens) and a
   per-tenant counter. ~50 lines and a metric exporter.
4. **HR-specific tool set.** Adding `schedule_interview`, `advance_to_round_2`,
   etc. is one schema + one executor + one registry entry per tool. The loop
   doesn't change.

None of these are loop-internal changes. The loop is the part that's done.

---

## Files

- `backend/app/services/chat_service.py` — the loop, `_execute_calls`, the accumulator, `_history_to_llm`, `_build_system_prompt`, `_summarize`.
- `backend/app/llm/base.py` — `LLMProvider` ABC, `LLMMessage`, `LLMResponse`, `ToolCall` dataclasses.
- `backend/app/tools/definitions.py` — `ACTION_TOOL_NAMES` set.
- `backend/app/tools/registry.py` — `_DEFAULT_EXECUTORS` map and `execute()` dispatcher.
- `backend/tests/test_chat_service.py` — 100% coverage of the loop, the cap, and every accumulator branch.
