# Milestone 0 — Project Scaffolding (retroactive plan)

This document records what was actually built for Milestone 0. Source of truth
for scope is `docs/v1_implementation_plan.md` (Milestone 0 section).

## Goal

Bootable backend and frontend with zero business logic. Establish the project
layout, dev environments, and a smoke-testable health endpoint.

## What was built

### Backend (`backend/`)

- Python virtual environment at `backend/venv/` (gitignored).
- `requirements.txt` with the initial dependency set:
  - fastapi, uvicorn[standard], sqlalchemy, pydantic, pydantic-settings,
    anthropic, pdfplumber, pytesseract.
- `.env.example` with `ANTHROPIC_API_KEY`, `DATABASE_URL`, `LLM_MODEL`.
- `backend/README.md` covering venv setup and run instructions.
- Directory layout per architecture doc Section 7:
  `app/{api,llm,llm/prompts,models,pipeline,schemas,services,tools}` and
  `tests/` — each with an empty `__init__.py` so the package imports cleanly.
- `app/main.py` — FastAPI app entry point with the health router mounted at
  `/api/health` and CORS middleware allowing the Vite dev origin.
- `app/config.py` — Pydantic `BaseSettings` reading `backend/.env`
  (anthropic_api_key, database_url, llm_model, cors_origins).
- `app/database.py` — SQLAlchemy engine + `SessionLocal` + `Base` +
  `init_db()` that imports all model modules and runs `create_all`. SQLite
  via `sqlite:///./agentic_ats.db`.
- Empty data model classes (Role, Criterion, Candidate, CriterionScore,
  ChatMessage) covering every column in architecture doc Section 3.2 so
  `init_db` produces all five tables on first boot.
- `app/api/health.py` — `GET /api/health` returns `{"status": "ok"}`.

### Frontend (`frontend/`)

- React + Vite SPA scaffolded under `frontend/`.
- `vite.config.js` proxying `/api` (HTTP) and `/ws` (WebSocket) to
  `http://localhost:8000`.
- `package.json` with react, react-dom, react-router-dom, plus
  `@vitejs/plugin-react` and vite as dev dependencies.
- `index.html` + `src/main.jsx` mounting `<App>` inside `<BrowserRouter>`.
- `src/App.jsx` — top nav (Roles, New Role, Workspace) and three route
  placeholders.
- `src/services/api.js` — base-URL aware fetch wrapper with `api.health()`.
- `src/styles.css` — global layout, button styles, and the green/red
  health badge so the user can see backend connectivity at a glance.
- Placeholder components under `src/components/{RoleList,RoleSetup,Workspace}/`.
- `frontend/README.md` with `npm install` / `npm run dev` instructions.

### Repo-level

- `.gitignore` for `backend/venv/`, `__pycache__/`, `.env`, `*.db`,
  `frontend/node_modules/`, `frontend/dist/`, IDE folders.

## Verification (deliverable in plan)

- `uvicorn app.main:app` starts and `curl /api/health` returns 200.
- `npm run dev` starts and the browser shows the health badge transitioning
  from "checking…" to "backend: ok".

## Files attributed to this milestone

```
backend/.env.example
backend/README.md
backend/requirements.txt                   (initial dependency set)
backend/app/__init__.py
backend/app/main.py                        (only health router mounted)
backend/app/config.py
backend/app/database.py                    (basic create_all, no migrations)
backend/app/api/__init__.py
backend/app/api/health.py
backend/app/models/__init__.py
backend/app/models/role.py
backend/app/models/criterion.py
backend/app/models/candidate.py            (no status/error_message yet)
backend/app/models/chat.py
backend/app/schemas/__init__.py
backend/app/services/__init__.py
backend/app/llm/__init__.py                (empty stub)
backend/app/llm/prompts/__init__.py
backend/app/tools/__init__.py
backend/app/pipeline/__init__.py
backend/tests/__init__.py
frontend/index.html
frontend/package.json                      (no playwright yet)
frontend/package-lock.json
frontend/vite.config.js
frontend/README.md
frontend/src/main.jsx
frontend/src/App.jsx                       (placeholder routes)
frontend/src/services/api.js               (health() only)
frontend/src/styles.css                    (base + health badge)
frontend/src/components/RoleList/RoleList.jsx        (placeholder)
frontend/src/components/RoleSetup/RoleSetup.jsx      (placeholder)
frontend/src/components/Workspace/Workspace.jsx      (placeholder)
```
