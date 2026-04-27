# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Two-app monorepo with no root-level tooling — work happens inside `backend/` or `frontend/`.

- `backend/` — Python 3 / FastAPI service. SQLite DB lives at `backend/agentic_ats.db`.
- `frontend/` — React 18 + Vite SPA. Proxies `/api` and `/ws` to `http://localhost:8000` (see `frontend/vite.config.js`).
- `docs/` — `v1_architecture.md` is the canonical design doc. `plans/` and `coverage/` track per-milestone work. `known_issues.md` lists observed bugs not yet fixed (consult before "fixing" something that may be intentional).

## Commands

### Backend (always work inside the venv at `backend/venv/` — never install into global Python)

```bash
cd backend
source venv/bin/activate

# Run dev server
uvicorn app.main:app --reload --port 8000

# Tests
pytest                                        # full suite
pytest tests/test_chat_service.py             # one file
pytest tests/test_chat_service.py::test_name  # one test
pytest --cov=app --cov-report=term-missing    # coverage
```

`pytest.ini` sets `asyncio_mode = auto`, so `async def` tests run without a marker.

Requires `ANTHROPIC_API_KEY` in `backend/.env` for any path that calls the LLM (chat, criteria extraction, resume parsing, scoring).

### Frontend

```bash
cd frontend
npm install
npm run dev          # Vite dev server on :5173
npm test             # vitest (jsdom)
npm run test:watch
npm run test:coverage
npm run build
```

## Architecture (the parts you can't infer from one file)

Read `docs/v1_architecture.md` for the full picture. Key invariants:

**Agentic chat loop lives in `ChatService`, not in the LLM provider.** `LLMProvider.chat()` (`app/llm/base.py`) handles a single LLM turn. `ChatService.handle_message` (`app/services/chat_service.py`) loops up to `MAX_ITERATIONS = 5`, executing tool calls in parallel and feeding results back. This separation is deliberate — provider swaps don't touch loop logic.

**Tools are the contract between the LLM and app data.** `app/tools/` is split into:
- `definitions.py` — JSON schemas exposed to the LLM (and the `ACTION_TOOL_NAMES` set used by the loop to detect mutations).
- `data_tools.py` — read-only executors (get/search/stats).
- `action_tools.py` — mutation executors (set_highlights, set_sort, reset, etc.).
- `registry.py` — name→executor dispatch. Adding a tool = definition + executor + registry entry.

**UI mutations are accumulated, not streamed per-call.** `UIMutationsAccumulator` in `chat_service.py` folds repeated action-tool calls into one payload sent on `chat_complete`. Highlight semantics there are subtle: `set_highlights` REPLACES the set (despite the additive language in older docs — see commit 847099d); `remove_highlights` before any set is recorded as a delta against whatever the frontend currently shows.

**Two WebSocket endpoints, both under `app/api/websocket.py`:**
- `/ws/roles/{role_id}/chat` — agentic chat. Streams `tool_status`, `chat_token`, `chat_complete`.
- `/ws/roles/{role_id}/progress` — resume parsing/scoring progress fan-out, backed by an in-process pub/sub (`app/pipeline/progress.py`).

**Resume pipeline** (`app/services/resume_service.py` + `app/pipeline/text_extractor.py`): pdfplumber → Tesseract OCR fallback → LLM structuring (`app/llm/prompts/parse_resume.py`) → per-candidate scoring (`score_candidate.py`). Candidates have a `status` field and a `stale_scores` flag; criteria edits mark scores stale and trigger re-scoring.

**Schema migrations are a tiny in-place shim** (`database.py::_apply_inplace_migrations`) — only handles `ADD COLUMN` on existing SQLite tables. There is no Alembic. If you add a non-additive schema change, you'll need to extend this or accept that local DBs need to be deleted.

**Frontend state lives in the backend.** The SPA is stateless across reloads; `useChat` and `useProgress` hooks (`frontend/src/hooks/`) wrap the WebSocket connections. The `?tab=` query param drives `RoleSetup` view switching (criteria vs. resumes).

## Conventions worth knowing

- Models, schemas, and services are split by entity: `models/` = SQLAlchemy ORM, `schemas/` = Pydantic request/response, `services/` = business logic.
- Prompt templates are Python modules under `app/llm/prompts/`, not external files.
- Frontend tests colocate with components (`Foo.jsx` + `Foo.test.jsx`); coverage config in `vite.config.js` excludes `main.jsx` and `test-setup.js`.
- The `verify-m*.mjs` scripts under `frontend/scripts/` are milestone smoke tests, not part of the normal test run.
