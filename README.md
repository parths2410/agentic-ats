# Agentic ATS

An applicant tracking system with an agentic chat interface. Recruiters describe roles in natural language; the LLM extracts criteria, parses uploaded resumes (with OCR fallback), scores candidates, and drives the UI through tool calls — highlights, sort order, and other mutations are issued by the agent and applied atomically in the SPA.

Two-app monorepo:

- `backend/` — Python 3 / FastAPI, SQLite, Anthropic Claude. Resume pipeline (pdfplumber → Tesseract OCR fallback → LLM structuring → per-candidate scoring) plus the agentic chat loop.
- `frontend/` — React 18 + Vite SPA. Two WebSockets per role: one for chat, one for resume-pipeline progress.
- `docs/` — `v1_architecture.md` is the canonical design doc. `known_issues.md` lists observed bugs that are not yet fixed (consult before "fixing" something that may be intentional).

## Prerequisites

- **Python 3.10+** with `venv`
- **Node 18+** and `npm`
- **Tesseract** — required by the resume pipeline as the OCR fallback when pdfplumber can't extract text from a scanned PDF
  - macOS: `brew install tesseract`
  - Debian/Ubuntu: `sudo apt-get install tesseract-ocr`
- **Anthropic API key** — any code path that touches the LLM (chat, criteria extraction, resume parsing, scoring) needs `ANTHROPIC_API_KEY`

## Fresh setup

```bash
git clone git@github.com:parths2410/agentic-ats.git
cd agentic-ats
```

### Backend

All Python work happens inside `backend/venv/`. Don't install into the global Python.

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY
```

`agentic_ats.db` (SQLite) is created automatically on first run. There is no Alembic — schema migrations are an in-place shim that only handles `ADD COLUMN`. If you pull a non-additive schema change, delete the local DB.

### Frontend

```bash
cd ../frontend
npm install
```

No `.env` needed for local dev — the Vite dev server proxies `/api` and `/ws` to `http://localhost:8000`.

## Running locally

You need two terminals (no concurrently-style script).

**Terminal 1 — backend:**

```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

Health check: `curl http://localhost:8000/api/health` → `{"status":"ok"}`

**Terminal 2 — frontend:**

```bash
cd frontend
npm run dev
```

Open http://localhost:5173.

## Tests

Backend:

```bash
cd backend && source venv/bin/activate
pytest                                        # full suite
pytest tests/test_chat_service.py             # one file
pytest --cov=app --cov-report=term-missing    # coverage
```

`pytest.ini` sets `asyncio_mode = auto`, so `async def test_*` runs without a marker. Tests stub the LLM provider, so `ANTHROPIC_API_KEY` is not required to run them.

Frontend:

```bash
cd frontend
npm test                  # vitest, single run
npm run test:watch
npm run test:coverage
```

`scripts/verify-m*.mjs` are milestone smoke scripts run manually — they are not part of `npm test`.

## Where to read next

- `docs/v1_architecture.md` — system design, agentic loop, tool contract, WebSocket protocol
- `docs/known_issues.md` — observed bugs / intentional rough edges
- `CLAUDE.md` (repo root, plus per-app variants in `backend/` and `frontend/`) — working notes for non-obvious invariants
