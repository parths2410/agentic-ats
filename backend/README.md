# Agentic ATS — Backend

Python / FastAPI backend for the agentic ATS.

## Setup

All Python work happens inside the venv at `backend/venv/`. Never install into the global Python environment.

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill in ANTHROPIC_API_KEY
```

## Run

```bash
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

Health check: `curl http://localhost:8000/api/health` → `{"status":"ok"}`
