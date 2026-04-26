# Milestone 4 — Chat-Driven UI Mutations — sub-plan

Source of truth: `docs/v1_implementation_plan.md` (Milestone 4 section) and
`docs/v1_architecture.md` Sections 2.3.5 + 4.

## Goal

The chat can highlight candidates and re-sort the list. Filter chaining
("from those…") works because get_ui_state returns the live state. Reset
restores the original ranking.

## Steps

### Step 1 — UI state persistence

- Add a `ui_states` table (or columns on `roles`) with:
  `role_id`, `highlighted_candidate_ids` (JSON), `sort_field`, `sort_order`.
  Use an `ALTER TABLE` or new model + in-place migration helper, consistent
  with `app.database._apply_inplace_migrations`.
- `app/services/ui_state_service.py` — get / set / clear helpers around the
  row. Auto-create on first read.
- Tests: `tests/test_ui_state_service.py`.

### Step 2 — Action tools

- `app/tools/action_tools.py` — `set_highlights`, `remove_highlights`,
  `clear_highlights`, `set_sort`, `reset_ui`. Each returns
  `{ "ui_state": ..., "mutation": {...} }` so the registry can surface the
  mutation back to ChatService without inferring it.
- `app/tools/definitions.py` — append the five action-tool definitions.
- `app/tools/registry.py` — wire executors. Update `default_registry()` so
  the ToolRegistry exposes both data and action tools.
- Make the M3 stub `get_ui_state` read from the new service so the LLM sees
  real state.
- Tests: `tests/test_action_tools.py`.

### Step 3 — UIMutations accumulator in ChatService

- Extend ChatService loop: when an action-tool result includes a `mutation`,
  merge it into a `UIMutations` accumulator. Return it on `ChatTurnResult`.
- Update the chat WebSocket `chat_complete` payload to include the merged
  mutations (already wired — just populate it now).
- Update the chat system prompt to mention the action tools, the additive
  highlight behavior, the filter-chaining pattern, and "never claim to hide
  candidates."
- Tests: extend `tests/test_chat_service.py` with action-tool scenarios.

### Step 4 — Chat reset endpoint

- `POST /api/roles/{id}/chat/reset` clears highlights + sort. Implemented
  inside the chat router for proximity.
- Tests: extend `tests/test_api_chat.py`.

### Step 5 — Frontend wiring

- `useChat` already surfaces `ui_mutations` per chat_complete. Hoist them
  out of useChat as a fresh callback so Workspace can apply them.
- Workspace owns `highlightedIds` state (Set) and `sort` state, seeded from
  a new `api.chat.uiState(roleId)` REST call on mount (or from the reset
  endpoint after a clear).
- CandidateCard adds a `highlighted` style. Sort indicator + count badge in
  the workspace header.
- "Reset" button calls the reset endpoint and clears local highlight/sort.
- Tests: extend `Workspace.test.jsx` and `useChat.test.js`.

## Verification

- Backend: pytest --cov passes ≥65%.
- Frontend: vitest run --coverage passes ≥65%.
- Manual: "Highlight Python candidates" → cards visually highlighted.
  "From those, who's in California?" → set narrows. "Sort by aggregate
  desc" → order changes. "Reset" → original order.
