# Agentic ATS — v1 Completion Report

This report summarizes what was built across milestones 0–5 against the
requirements in `docs/v1_requirements.md`, the design in
`docs/v1_architecture.md`, and the milestone plan in
`docs/v1_implementation_plan.md`.

## Final coverage

- **Backend:** 96.5% statement coverage (210 tests, all passing)
- **Frontend:** 89.5% statement coverage (75 tests, all passing)

Per-milestone snapshots are saved under `docs/coverage/`:
- `backend_milestone_3/summary.txt` – `backend_milestone_5/summary.txt`
- `frontend_milestone_3/summary.txt` – `frontend_milestone_5/summary.txt`

The fail-under threshold of 65% in `backend/.coveragerc` is enforced on
every backend `pytest --cov` run.

## What was built per milestone

### Milestone 0 — Project Scaffolding

Already complete on entry. Sub-plan: `docs/plans/milestone_0_plan.md`.

- Python venv + FastAPI app with `/api/health`.
- SQLAlchemy models for roles, criteria, candidates, criterion_scores,
  chat_messages.
- React + Vite SPA with three placeholder routes and a backend health
  badge.

### Milestone 1 — Role Management + Criteria Extraction

Already complete on entry. Sub-plan: `docs/plans/milestone_1_plan.md`.

- Role CRUD service + REST endpoints.
- LLMProvider ABC + AnthropicProvider with `extract_criteria()`.
- Criteria editor UI: extract from JD, edit, add/remove manual, save.

### Milestone 2 — Resume Upload + Parsing + Scoring

Already complete on entry. Sub-plan: `docs/plans/milestone_2_plan.md`.

- pdfplumber-first text extraction with Tesseract OCR fallback.
- AnthropicProvider `parse_resume()` + `score_candidate()`.
- ResumeService orchestration with concurrent per-candidate processing.
- `/api/roles/:id/candidates/upload` + listing/detail/scores/delete +
  `/score` re-score endpoint.
- WebSocket progress channel `/ws/roles/:id/progress`.
- Frontend Workspace with ranked candidate list, expandable detail,
  per-criterion mini scores, processing progress bar.

### Milestone 3 — Agentic Chat (Core)

Built. Sub-plan: `docs/plans/milestone_3_plan.md`.

- Seven data-retrieval tools (`get_candidates`, `get_candidate_detail`,
  `get_candidate_raw_text`, `get_candidate_scores`, `search_candidates`,
  `compute_stats`, `get_ui_state`) with Anthropic-format JSON Schemas.
- ToolRegistry that dispatches by name and tolerates None args.
- LLM types module (`LLMMessage`, `ToolCall`, `LLMResponse`) + `chat()`
  method on `LLMProvider` ABC, implemented in AnthropicProvider against
  the native tool-use API.
- ChatService loop (≤5 iterations, persisted history, optional tool-status
  callback for streaming progress to the WS).
- REST `GET/DELETE /api/roles/:id/chat/history` + WebSocket
  `/ws/roles/:id/chat`.
- Frontend `useChat` hook + ChatPanel component, wired into the Workspace.

### Milestone 4 — Chat-Driven UI Mutations

Built. Sub-plan: `docs/plans/milestone_4_plan.md`.

- New `ui_states` table + `UIStateService` for per-role highlight + sort.
- Five action tools (`set_highlights`, `remove_highlights`,
  `clear_highlights`, `set_sort`, `reset_ui`); the M3 stub `get_ui_state`
  now reads from the real service so the LLM can chain filters.
- ChatService `UIMutationsAccumulator` merges per-iteration mutations
  (with add/remove cancellation, last-write-wins sort, reset supremacy).
- REST `GET /api/roles/:id/chat/ui-state` + `POST /api/roles/:id/chat/reset`.
- Updated chat system prompt with explicit filter-chaining + additive
  highlight rules.
- Frontend: Workspace seeds highlights + sort from UI state on mount,
  applies mutations from chat_complete, sorts the candidate list locally
  by criterion or aggregate, surfaces a "Reset view" button.

### Milestone 5 — Polish & Edge Cases

Built. Sub-plan: `docs/plans/milestone_5_plan.md`.

- `stale_scores` column on candidates with an in-place migration; criteria
  create/update/delete now mark scored candidates stale; re-scoring clears
  the flag. The Workspace shows a "Scores are out of date" banner with a
  Re-score now action when any candidate is stale.
- Retry-with-exponential-backoff helper around the Anthropic SDK so
  transient `RateLimitError` / `APIConnectionError` /
  `InternalServerError` / 5xx responses don't fail a whole batch.
- Parse-confidence pills on the expanded candidate detail card.

## Skipped items (TODOs / explicit deferrals)

- **No TODO comments were left in the code.** The features the plan
  marks "future-proofed but not required" (e.g., LLM Vision fallback for
  heavily designed PDFs, token-by-token assistant streaming, native
  WebSocket reconnection, role-switcher dropdown) are not implemented;
  the existing surfaces are sufficient for the v1 manual walkthrough.
- The candidate-card "delete role" confirmation uses the native
  `window.confirm` rather than a custom dialog. The plan listed this as
  a polish item; we kept the simpler implementation.
- The chat-history endpoint returns the full message log without
  pagination. Chat sessions in v1 are short-lived so this is acceptable.

## How to run the project

### Prerequisites

- Python 3.11
- Node 18+
- `tesseract` system package (only needed for the OCR fallback path)
- An Anthropic API key

### Backend

```bash
cd agentic-ats/backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # then edit ANTHROPIC_API_KEY
uvicorn app.main:app --reload
```

The API serves on `http://localhost:8000`. Health check: `GET /api/health`.

### Frontend

```bash
cd agentic-ats/frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` and `/ws` to the
backend on port 8000.

### End-to-end smoke test

1. Visit `/` → "+ New Role".
2. Paste a JD, save → click "Extract Criteria" → review/edit → save.
3. Drop a few PDF resumes into the upload zone → wait for the progress
   bar to clear.
4. Open Workspace → review the ranked list.
5. In chat: "Highlight candidates with Python." → cards highlight.
   "From those, who's in California?" → set narrows. "Sort by aggregate
   desc." → order changes. "Reset." → original ranking restored.
6. Edit a criterion → see the "Scores are out of date" banner → click
   Re-score now.

## How to run tests with coverage

### Backend

```bash
cd agentic-ats/backend
source venv/bin/activate
pytest --cov --cov-report=term-missing
# HTML report:
pytest --cov --cov-report=html:../docs/coverage/backend_latest
```

The `.coveragerc` enforces a 65% floor. Current run: **96.5%**, 210
tests passing.

### Frontend

```bash
cd agentic-ats/frontend
npm test                    # one-shot, no coverage
npm run test:watch          # watch mode
npm run test:coverage       # text + HTML coverage in ./coverage/
```

Current run: **89.5%**, 75 tests passing.
