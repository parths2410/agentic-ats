# CLAUDE.md — backend

Python / FastAPI service. See repo-root `CLAUDE.md` for cross-cutting architecture; this file is for backend-specific working knowledge.

## Working in the venv

All Python work goes through `backend/venv/`. Activate before doing anything — don't rely on a system `python3` or `pip`.

```bash
source venv/bin/activate
```

If a command "can't find" a package (`fastapi`, `pytest`, etc.), the venv isn't active.

## Tests

`pytest.ini` sets `asyncio_mode = auto`, so `async def test_*` runs without `@pytest.mark.asyncio`. Most service/API tests are async because the chat path is.

Key fixtures in `tests/conftest.py`:

- `engine` / `session_factory` / `db` — in-memory SQLite, isolated per test, with `app.database.engine` and `SessionLocal` monkeypatched so the app code under test transparently uses the in-memory DB.
- `role`, `criteria`, `candidates` — pre-seeded fixtures. The `candidates` fixture deliberately includes one `pending` candidate (no profile, no scores) to exercise null-handling. Reuse these instead of building roles from scratch.

Run a single test:

```bash
pytest tests/test_chat_service.py::test_loop_executes_action_tool -x
```

## Layering rules

- `api/` handlers should be thin: parse request, call a service, shape the response. Business logic does not live here.
- `services/` own multi-step orchestration and DB writes. The agentic loop lives in `services/chat_service.py` — do not push it into `llm/` (provider stays single-turn).
- `llm/` is provider-swappable. `base.py` defines the ABC; `anthropic_provider.py` is the only impl. Prompts live as Python modules in `llm/prompts/` (not external files) so they're typed and importable.
- `tools/` is the LLM↔app contract. To add a tool: (1) schema in `definitions.py`, (2) executor in `data_tools.py` or `action_tools.py`, (3) wire both in `registry.py`. If it mutates UI state, also add the name to `ACTION_TOOL_NAMES` so the chat loop folds it into `UIMutationsAccumulator`.
- `pipeline/` handles resume processing (`text_extractor.py`) and the in-process pub/sub for progress events (`progress.py`).

## Schema changes

There is no Alembic. `database._apply_inplace_migrations` runs on startup and only handles `ADD COLUMN` against existing SQLite tables (see the existing entries for `status`, `error_message`, `stale_scores`). For anything else (rename, drop, type change), either extend that shim with explicit SQL or accept that local `agentic_ats.db` files need to be deleted.

## LLM key

`ANTHROPIC_API_KEY` must be in `backend/.env` for any code path that touches the provider. Tests stub the provider — they don't need a key.

## Conventions

- Models = SQLAlchemy ORM (`models/`). Schemas = Pydantic request/response (`schemas/`). Don't conflate them in handlers.
- UUIDs are stored as strings; generate with `uuid.uuid4()` and pass `str()` into ORM constructors.
- The agentic loop has a hard `MAX_ITERATIONS = 5` safety cap in `chat_service.py`. Don't quietly raise it — the cap exists because misbehaving prompts can ping-pong tools forever.
