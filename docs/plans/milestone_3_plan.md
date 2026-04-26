# Milestone 3 — Agentic Chat (Core) — sub-plan

Source of truth: `docs/v1_implementation_plan.md` (Milestone 3 section) and
`docs/v1_architecture.md` Section 2.3.

## Goal

Conversational interface backed by an agentic tool-use loop. The LLM can
query candidate data via 7 read-only tools and answer questions. No UI
mutations yet (those land in M4).

## Steps

Each step ends with unit tests and a coverage check (≥65% over `app/`).

### Step 1 — Tool definitions + registry + data executors

- `app/tools/definitions.py` — Anthropic-format tool schemas for the seven
  data-retrieval tools (get_candidates, get_candidate_detail,
  get_candidate_raw_text, get_candidate_scores, search_candidates,
  compute_stats, get_ui_state). UI-state tool returns a stub for now
  (highlighted_ids=[], current_sort=None) — wired for real in M4.
- `app/tools/data_tools.py` — executor functions, each takes a SQLAlchemy
  Session + parsed args and returns plain-JSON dicts/lists.
- `app/tools/registry.py` — `ToolRegistry`: holds definitions, dispatches
  `execute(name, args, db)`, raises `UnknownToolError` on bad names.
- Tests: `tests/test_tool_definitions.py`, `tests/test_data_tools.py`,
  `tests/test_tool_registry.py` — happy path + error case per tool.

### Step 2 — LLM `chat()` provider method + LLMResponse type

- `app/llm/types.py` (or extend base) — `LLMMessage`, `ToolCall`,
  `LLMResponse(text, tool_calls, stop_reason, raw)`.
- Extend `LLMProvider` ABC with `async def chat(messages, tools,
  system_prompt) -> LLMResponse`.
- Implement on `AnthropicProvider`: maps to Anthropic's tool_use API.
- Tests: `tests/test_anthropic_provider_chat.py` — patch the AsyncAnthropic
  client, verify message construction, tool-call parsing, text-only path.

### Step 3 — Chat system prompt + ChatService loop

- `app/llm/prompts/chat_system.py` — system-prompt builder using role title,
  JD, criteria list, candidate count.
- `app/services/chat_service.py` — loads history, builds system prompt,
  enters loop (max 5 iterations), executes tools in parallel, persists
  user+assistant messages to `chat_messages`. Returns `ChatResponse(text,
  tool_trace)`. UI mutations stay null for M3.
- `app/schemas/chat.py` — pydantic schemas for chat history + responses.
- Tests: `tests/test_chat_service.py` — fake LLM provider that emits a
  scripted sequence (tool_call → tool_call → text), verifies loop calls
  registry, persists messages, respects iteration cap.

### Step 4 — REST chat history endpoints

- `app/api/chat.py` — `GET /api/roles/{id}/chat/history`, `DELETE
  /api/roles/{id}/chat/history`.
- Wire into `app/main.py`.
- Tests: `tests/test_api_chat.py` — TestClient against an in-memory SQLite,
  fixture seeds messages, validates response shapes and 404 on unknown role.

### Step 5 — Chat WebSocket endpoint

- Add `/ws/roles/{role_id}/chat` to `app/api/websocket.py`.
- On user message: drive ChatService loop, send `tool_status` events per
  iteration, stream final response (single chunk for now — token streaming
  optional in M5), send `chat_complete`.
- Tests: `tests/test_chat_websocket.py` — FastAPI TestClient `websocket_connect`
  with a fake LLM provider override; assert the event sequence.

### Step 6 — Frontend chat panel

- `src/components/Workspace/ChatPanel.jsx` — message input, history,
  tool-status indicators, connects via WS hook.
- `src/hooks/useChat.js` — manage WebSocket lifecycle, event dispatch,
  history loading via `api.chatHistory(role_id)`.
- Wire ChatPanel into `Workspace.jsx` as the right column. Add clear-history
  button.
- Tests: `src/hooks/useChat.test.js`, `src/components/Workspace/ChatPanel.test.jsx`
  — fake WebSocket + fetch mocks, cover send → status → complete and history
  load + clear flows.

## Verification

- Backend: pytest --cov passes ≥65%.
- Frontend: vitest run --coverage passes ≥65%.
- Manual: with API key set, run uvicorn + npm dev, open a role with
  candidates, ask a few questions, verify replies reference real candidates.
