# Job Application Ranking & Analysis Tool — v1 Implementation Plan

## Guiding Principle

Get to a working end-to-end flow as early as possible (Milestone 2), then layer on capabilities. Every milestone produces something you can run and test — no milestone requires faith that "it'll come together later."

---

## Project Bootstrap

### Initial Project Structure

Before starting any milestone, set up your project folder like this:

```
agentic-ats/
├── docs/
│   ├── v1_requirements.md
│   ├── v1_architecture.md
│   └── v1_implementation_plan.md
├── backend/
│   └── (empty — M0 will scaffold this)
├── frontend/
│   └── (empty — M0 will scaffold this)
├── .gitignore
└── README.md
```

Create this manually:

```bash
mkdir agentic-ats
cd agentic-ats
mkdir docs backend frontend
# Copy the three downloaded docs into docs/
cp ~/Downloads/v1_requirements.md docs/
cp ~/Downloads/v1_architecture.md docs/
cp ~/Downloads/v1_implementation_plan.md docs/
git init
```

Create a `.gitignore`:

```
# Python
backend/venv/
__pycache__/
*.pyc
.env

# Node
frontend/node_modules/
frontend/dist/

# IDE
.vscode/
.idea/

# Data
*.db
*.sqlite
```

### Environment Constraints

- **Python backend**: All Python work MUST happen inside a virtual environment (`backend/venv/`). Never install packages globally or into the system Python. Every `pip install`, `uvicorn`, and `pytest` command runs inside the activated venv.
- **Node frontend**: npm handles isolation via `node_modules/` — no extra steps, but all npm commands should be run from inside the `frontend/` directory.

### Starting Prompt for Claude Code

Once your project folder is set up with the three docs, open Claude Code in the `agentic-ats/` directory and use this prompt:

```
Read these three documents carefully — they are the finalized requirements, 
architecture, and implementation plan for this project:

- docs/v1_requirements.md
- docs/v1_architecture.md  
- docs/v1_implementation_plan.md

This is a greenfield project. The backend/ and frontend/ directories are empty.

Important constraints:
- The Python backend MUST use a virtual environment at backend/venv/. 
  Never install anything into the global Python environment.
- Follow the directory structure defined in the architecture doc (Section 7).
- Follow the milestones sequentially as defined in the implementation plan.

Let's start with Milestone 0: Project Scaffolding. Set up the backend 
virtual environment, install initial dependencies, scaffold the FastAPI 
app with a health check endpoint, scaffold the React + Vite frontend, 
and verify both can start and communicate.
```

### Prompting for Subsequent Milestones

When you finish a milestone and are ready for the next:

```
Milestone [N-1] is complete. Let's start Milestone [N]. 
Refer to docs/v1_implementation_plan.md for the full task list.
Start with [first task you want to tackle].
```

If Claude Code loses context in a long session or you start a new session:

```
Read docs/v1_requirements.md, docs/v1_architecture.md, and 
docs/v1_implementation_plan.md. 

Milestones 0 through [N-1] are already implemented. Review the current 
codebase to familiarize yourself with what exists, then let's continue 
with Milestone [N].
```

---

## Milestone 0: Project Scaffolding

**Goal**: Bootable backend and frontend with zero business logic. Confirm the dev environment works.

**Environment setup (do this first)**:
- Create a Python virtual environment in the backend directory. All Python dependencies must be installed inside this venv — never install into the system/global Python environment.
- Use `python -m venv venv` to create and `source venv/bin/activate` (or `venv/Scripts/activate` on Windows) to activate.
- All subsequent `pip install` commands and `uvicorn` runs must happen inside the activated venv.
- Add `venv/` to `.gitignore`.
- For the frontend, `node_modules/` is already isolated per-project by npm — no extra steps needed, but also add `node_modules/` to `.gitignore`.

**Backend tasks**:
- Initialize Python project structure per architecture doc (app/, models/, schemas/, api/, services/, llm/, tools/, pipeline/)
- Set up FastAPI app entry point with a health check endpoint (`GET /api/health`)
- Set up SQLite database connection with SQLAlchemy
- Create all database tables (roles, criteria, candidates, criterion_scores, chat_messages) — empty, no data
- Add `requirements.txt` with initial dependencies: fastapi, uvicorn, sqlalchemy, pydantic, anthropic, pdfplumber, pytesseract
- Add a `.env.example` with `ANTHROPIC_API_KEY` placeholder
- Confirm the server starts and returns 200 on health check

**Frontend tasks**:
- Initialize React + Vite project
- Set up basic routing (three placeholder pages: Role List, Role Setup, Workspace)
- Add an API service module with base URL config and a test call to `/api/health`
- Confirm the dev server starts and renders a page

**Deliverable**: `uvicorn app.main:app` starts, `npm run dev` starts, frontend can call backend health check. No business logic yet.

**Verification**: Hit `/api/health` from both curl and the browser app.

---

## Milestone 1: Role Management + Criteria Extraction

**Goal**: Create a role with a job description, auto-extract scoring criteria, and edit them. This is the first LLM integration.

**Backend tasks**:
- Implement RoleService: create, read, update, delete roles
- Implement Role CRUD API endpoints (`POST/GET/PUT/DELETE /api/roles`, `GET /api/roles/{id}`)
- Implement LLM abstraction layer base class (`LLMProvider` ABC in `llm/base.py`)
- Implement `AnthropicProvider.extract_criteria()` — takes a JD, returns proposed criteria with descriptions and default weights
- Write the criteria extraction prompt in `llm/prompts/extract_criteria.py`
- Implement Criteria API endpoints (`POST /api/roles/{id}/criteria/extract`, `GET/POST/PUT/DELETE` for criteria CRUD)
- Criteria extraction should return structured JSON: list of `{name, description, weight, source: "auto"}`

**Frontend tasks**:
- Build Role List view: display all roles, create new role button
- Build Role Setup view (partial — JD input only for now):
  - Text area for job description
  - "Extract Criteria" button that calls the criteria extraction endpoint
  - Criteria editor: display proposed criteria as editable cards
  - Each card has: name (editable), description (editable), weight slider, delete button
  - "Add criterion" button for manual additions
  - Save button to persist criteria

**Prompt engineering notes**:
- The criteria extraction prompt should instruct the LLM to:
  - Extract 5-10 concrete, scorable criteria from the JD
  - Include both hard requirements (specific skills, years of experience) and soft qualities (leadership, communication)
  - Provide a clear description for each criterion explaining what to look for in a resume
  - Assign default weights (1.0 for must-haves, 0.5 for nice-to-haves)
- Test with 2-3 real job descriptions and iterate on prompt quality

**Deliverable**: You can create a role, paste a JD, see auto-extracted criteria, edit them, and save. Data persists in SQLite.

**Verification**: Create a role with a real JD, verify criteria make sense, edit them, refresh the page, confirm they persisted.

---

## Milestone 2: Resume Upload + Parsing + Scoring (End-to-End)

**Goal**: Upload PDFs, parse them into structured profiles, score against criteria, and see a ranked list. This is the first complete pipeline.

**Backend tasks**:
- Implement text extraction pipeline (`pipeline/text_extractor.py`):
  - Primary: pdfplumber for layout-aware text extraction
  - Fallback: Tesseract OCR when pdfplumber yields little/no text
  - Return raw text string
- Implement `AnthropicProvider.parse_resume()`:
  - Takes raw text, returns StructuredProfile JSON
  - Write prompt in `llm/prompts/parse_resume.py`
- Implement `AnthropicProvider.score_candidate()`:
  - Takes profile + JD + criteria, returns per-criterion scores + rationales
  - Write prompt in `llm/prompts/score_candidate.py`
- Implement ResumeService:
  - Handle PDF upload (store binary + filename)
  - Orchestrate: extract text → parse with LLM → score with LLM → store results
  - Process candidates concurrently (asyncio.gather for parallel LLM calls)
  - Compute weighted aggregate score and rank
- Implement Candidate API endpoints:
  - `POST /api/roles/{id}/candidates/upload` (multipart file upload, batch)
  - `GET /api/roles/{id}/candidates` (ranked list with scores)
  - `GET /api/roles/{id}/candidates/{id}` (full detail)
  - `GET /api/roles/{id}/candidates/{id}/scores` (per-criterion breakdown)
  - `DELETE /api/roles/{id}/candidates/{id}`
- Implement Scoring API endpoint:
  - `POST /api/roles/{id}/score` (re-score all candidates)
- Implement WebSocket progress endpoint (`ws://host/ws/roles/{id}/progress`):
  - Push progress updates during parsing and scoring stages

**Frontend tasks**:
- Add resume upload zone to Role Setup view:
  - Drag-and-drop or file picker, multi-PDF
  - Upload button triggers batch processing
  - Progress bar connected to WebSocket progress endpoint
- Build Workspace view (left panel only — no chat yet):
  - Ranked candidate list: cards showing name, aggregate score, per-criteria mini scores
  - Click to expand: show full structured profile + per-criterion score rationales
  - Sort indicator

**Prompt engineering notes**:
- Resume parsing prompt — critical to get right:
  - Define the exact JSON schema the LLM must output (StructuredProfile)
  - Handle edge cases explicitly: "If you cannot determine a field, set it to null. If dates are ambiguous, use your best interpretation and set confidence to low."
  - Include confidence_scores per section
  - Test against messy resumes: multi-column, design-heavy, sparse, non-standard section headers
- Scoring prompt:
  - Provide the criteria definitions and weight context
  - Instruct scoring on a 1-10 scale with clear anchor descriptions (1 = no evidence, 5 = meets expectations, 10 = exceptional)
  - Require a 1-2 sentence rationale per criterion
  - Test: score the same candidate with different criteria weights, verify the rationales adjust

**Deliverable**: Full pipeline works — create role, define criteria, upload resumes, see ranked candidates with scores. This is the first "usable" version.

**Verification**: Upload 5-10 real/sample resumes for a role. Verify: all parsed correctly (spot-check structured profiles), scores are reasonable, ranking order makes sense, rationales are coherent. Re-score after changing criteria weights and verify rankings shift.

---

## Milestone 3: Agentic Chat (Core)

**Goal**: Conversational interface with the agentic tool-use loop. The LLM can query candidate data and answer questions.

**Backend tasks**:
- Implement tool definitions (`tools/definitions.py`):
  - All 7 data retrieval tools: get_candidates, get_candidate_detail, get_candidate_raw_text, get_candidate_scores, search_candidates, compute_stats, get_ui_state
  - Format as Anthropic tool-use schema (name, description, input_schema)
- Implement tool executors (`tools/data_tools.py`):
  - Each tool queries the database and returns structured results
  - search_candidates: query structured profiles by field + keyword
  - compute_stats: aggregate queries over candidate pool
- Implement tool registry (`tools/registry.py`):
  - Loads all tool definitions
  - Dispatches execution by tool name
  - Returns structured results
- Implement `AnthropicProvider.chat()` — single-turn LLM call with tool-use support:
  - Passes tool definitions to the Anthropic API
  - Returns LLMResponse with either text content, tool_calls, or both
- Implement ChatService agentic loop (`services/chat_service.py`):
  - The while loop: call provider.chat() → if tool_calls, execute via registry, append results, loop → if text, exit
  - Max iteration cap (5)
  - Persist conversation history to chat_messages table
  - Build system prompt with role context (see architecture doc Section 2.3.4)
- Write the chat system prompt (`llm/prompts/chat_system.py`)
- Implement Chat API endpoints:
  - `GET /api/roles/{id}/chat/history`
  - `DELETE /api/roles/{id}/chat/history`
- Implement Chat WebSocket endpoint (`ws://host/ws/roles/{id}/chat`):
  - Receive user messages
  - Send tool_status updates during loop iterations
  - Stream final text response token-by-token
  - Send chat_complete with full response

**Frontend tasks**:
- Build Chat Panel (right side of Workspace):
  - Message input with send button
  - Message history display (user + assistant messages)
  - Tool status indicators ("Searching candidates...", "Computing statistics...")
  - Streaming text display for assistant responses
  - Connect to chat WebSocket
- Load chat history on workspace mount
- Clear history button

**Prompt engineering notes**:
- The chat system prompt is the most important prompt in the system. Key things to get right:
  - Tool selection: the LLM must reliably choose the right tool for the query
  - Tool argument construction: field names, query strings, stat types must match what the executors expect
  - Response quality: concise, actionable, references specific candidates and criteria
- Test systematically against the query types in the architecture doc (Section 2.3.3):
  - Stats questions: "What percentage have X?"
  - Deep dives: "Tell me about candidate Y's experience with Z"
  - Comparisons: "Compare the top 3 on criterion W"
  - Justifications: "Why is candidate Y ranked #8?"
- Iterate on tool descriptions — the LLM's tool selection is heavily influenced by how well the descriptions explain when to use each tool

**Deliverable**: You can have a natural language conversation about the candidate pool. The LLM queries data via tools and produces informed answers. No UI mutations yet (highlights/sort) — that's next.

**Verification**: With resumes loaded, ask 10+ diverse questions covering each query type. Verify the LLM selects appropriate tools, the results are factually correct (cross-check against raw resumes), and the responses are useful.

---

## Milestone 4: Chat-Driven UI Mutations

**Goal**: The chat can highlight candidates and re-sort the list. Filter chaining works.

**Backend tasks**:
- Implement action tools (`tools/action_tools.py`):
  - set_highlights, remove_highlights, clear_highlights, set_sort, reset_ui
  - These mutate a UI state record in the database (per-role)
- Add action tools to the registry and definitions
- Add UI state table (or add columns to roles table):
  - highlighted_candidate_ids (JSON array)
  - current_sort_field, current_sort_order
- Update ChatService to extract UI mutations from action-tool calls during the loop:
  - Accumulate mutations into UIMutations response object
  - Include in chat_complete WebSocket message
- Implement `POST /api/roles/{id}/chat/reset` endpoint (clears UI state)
- Update chat system prompt with behavioral rules for highlighting:
  - "Use set_highlights for filter/highlight requests"
  - "For filter chaining, call get_ui_state first to see current highlights, then intersect"
  - "Never claim to hide or remove candidates — only highlight matches"

**Frontend tasks**:
- Apply soft highlight styling to candidate cards based on ui_mutations from chat_complete:
  - Maintain highlight state in React state, seeded from backend UI state on load
  - When chat_complete arrives with highlights.add, update state → visual change (colored border/background)
- Apply re-sort when ui_mutations includes re_sort
- Reset button: calls reset endpoint, clears local highlight/sort state
- Visual indicators: show how many candidates are highlighted, current sort basis

**Prompt engineering notes**:
- Filter chaining is the trickiest behavior to get right:
  - "Highlight candidates with Python" → set_highlights([A, B, C])
  - "From those, highlight ones in California" → get_ui_state() → sees [A, B, C] highlighted → search for California → intersect → set_highlights([A, C])
  - The system prompt must clearly instruct this intersection behavior
- Test edge cases:
  - "Highlight everyone" → should it highlight all or just acknowledge?
  - "Remove highlight from candidate #2" → remove_highlights
  - "Reset" → reset_ui
  - "Sort by education score" → set_sort
  - "Undo the sort" → reset just the sort, keep highlights

**Deliverable**: Chat can drive the candidate list — highlights appear/disappear, sorting changes, filter chaining works, reset restores original state.

**Verification**: Run through a full scenario: "Highlight Python candidates" → verify visually → "From those, who's in California?" → verify intersection → "Sort by aggregate score descending" → verify order changes → "Reset" → verify original state restored.

---

## Milestone 5: Polish & Edge Cases

**Goal**: Harden everything that's built. Handle edge cases, improve UX, clean up.

**Backend tasks**:
- Resume parsing edge cases:
  - Test with scanned PDFs → verify Tesseract fallback works
  - Test with heavily designed resumes → evaluate if LLM vision fallback is needed (defer implementation if not)
  - Handle corrupt/unreadable PDFs gracefully (error message, skip candidate, don't crash batch)
- Add resume upload to existing roles (currently only on setup — allow adding more candidates later)
- Re-scoring when criteria change:
  - When criteria are edited via API, mark scores as stale
  - Provide a "re-score" button/endpoint that re-runs the scoring pipeline
- Error handling across all endpoints:
  - LLM API failures (rate limits, timeouts) → retry with backoff, surface error to user
  - Malformed PDF uploads → clear error message
  - WebSocket disconnection → reconnect handling on frontend
- Chat session memory across browser sessions:
  - Chat history already persists in DB — ensure frontend loads it on workspace mount
  - UI state (highlights, sort) also loads from DB on mount

**Frontend tasks**:
- Role switching: dropdown in workspace top bar, switches all context (candidate list, chat, criteria)
- Candidate card improvements:
  - Parse confidence indicators (flag low-confidence sections visually)
  - Per-criterion score bars or badges on collapsed card
- Chat UX improvements:
  - Auto-scroll on new messages
  - Loading indicator during agentic loop (with tool status context)
  - Error display for failed queries
  - Keyboard shortcut: Enter to send
- Responsive layout: ensure the two-panel workspace renders reasonably on different screen sizes
- Role deletion with confirmation dialog
- Empty states: no roles yet, no candidates yet, no chat history yet

**Deliverable**: A solid, usable application that handles real-world messiness without crashing or confusing the user.

**Verification**: Full end-to-end walkthrough:
1. Create two roles with different JDs
2. Upload 10+ resumes to each (include some messy/scanned ones)
3. Review rankings and scores for both roles
4. Switch between roles, verify scoping
5. Have a multi-turn chat conversation with filter chaining
6. Close browser, reopen — verify everything persisted
7. Edit criteria, re-score, verify rankings change
8. Delete a role, verify cleanup

---

## Milestone Dependency Graph

```
M0: Scaffolding
 │
 ▼
M1: Role Management + Criteria
 │
 ▼
M2: Resume Pipeline + Scoring  ← first usable version
 │
 ▼
M3: Agentic Chat (Core)
 │
 ▼
M4: Chat UI Mutations
 │
 ▼
M5: Polish & Edge Cases
```

All milestones are sequential — each builds on the previous. No parallel workstreams to coordinate.

---

## Working with Claude Code

When starting each milestone in Claude Code, use this pattern:

```
Read docs/v1_requirements.md, docs/v1_architecture.md, and docs/v1_implementation_plan.md.
Let's work on Milestone N. Here's what it covers: [paste the milestone section].
Start with [first task in the milestone].
```

**Critical reminders for every session**:
- All Python commands (`pip install`, `uvicorn`, `pytest`, etc.) must run inside the virtual environment at `backend/venv/`. If Claude Code runs a bare `pip install` without activating the venv first, correct it immediately.
- All npm commands must run from inside the `frontend/` directory.

For prompt engineering tasks (milestones 1-3), iterate in the Claude Code session:
1. Write the initial prompt
2. Test it against a real input (paste a real JD or resume)
3. Review the output quality
4. Refine the prompt
5. Repeat until quality is solid

For frontend tasks, have Claude Code generate components one at a time and verify each in the browser before moving on.

---

## What This Plan Does NOT Cover (Deferred)

These are explicitly out of scope per the requirements doc, but noted here for future planning:
- Authentication and multi-user support
- Candidate lifecycle tracking (interview stages, notes, offers)
- Compliance and bias auditing
- Local LLM deployment
- Non-PDF resume formats
- Automated job posting / applicant intake
