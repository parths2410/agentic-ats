# Job Application Ranking & Analysis Tool — v1 Architecture

## 1. System Overview

```
┌─────────────────────┐         ┌──────────────────────────────────┐
│                     │  REST   │           Python Backend          │
│   React + Vite      │◄───────►│                                  │
│   (Static SPA)      │   +     │  ┌───────────┐  ┌────────────┐  │
│                     │  WS     │  │  REST API  │  │  WebSocket │  │
└─────────────────────┘         │  │  (FastAPI) │  │  Server    │  │
                                │  └─────┬─────┘  └─────┬──────┘  │
        ┌───────────┐           │        │              │          │
        │ External  │           │  ┌─────▼──────────────▼──────┐  │
        │ API       │◄──────────│  │      Service Layer         │  │
        │ Consumer  │  REST     │  │                            │  │
        └───────────┘           │  │  ┌──────┐ ┌──────┐ ┌────┐ │  │
                                │  │  │Role  │ │Resume│ │Chat│ │  │
                                │  │  │Svc   │ │Svc   │ │Svc │ │  │
                                │  │  └──┬───┘ └──┬───┘ └─┬──┘ │  │
                                │  └─────┼────────┼───────┼────┘  │
                                │        │        │       │       │
                                │  ┌─────▼────────▼───────▼────┐  │
                                │  │       LLM Abstraction      │  │
                                │  │         Layer              │  │
                                │  └────────────┬───────────────┘  │
                                │               │                  │
                                │  ┌────────────▼───────────────┐  │
                                │  │     SQLite Database         │  │
                                │  └────────────────────────────┘  │
                                └──────────────────────────────────┘
                                                │
                                                ▼
                                    ┌───────────────────┐
                                    │   LLM Provider    │
                                    │   (Anthropic API) │
                                    └───────────────────┘
```

The frontend is a standalone static SPA that communicates with the backend exclusively via REST and WebSocket. The backend exposes the same API to both the frontend and any external tool.

---

## 2. Component Breakdown

### 2.1 Frontend (React + Vite)

A single-page application with three primary views:

**Role List View**
- List of all created roles with title and applicant count
- Create new role button

**Role Setup View**
- Job description input (text area)
- Criteria editor: system-proposed criteria displayed as editable cards with weight sliders
- Add/remove/edit criteria controls
- Resume upload zone (drag-and-drop or file picker, multi-file)
- Processing progress bar

**Role Workspace View** (the main working screen)
- **Left panel**: Ranked candidate list
  - Each card shows: candidate name, aggregate score, per-criteria mini scores
  - Soft highlight styling (e.g., colored border/background) applied via chat commands
  - Sort indicator showing current ranking basis
  - Click to expand brief profile summary
- **Right panel**: Chat interface
  - Message history with session memory
  - Streaming response display
  - Reset button to clear all chat-driven mutations
- **Top bar**: Role title, switch role dropdown, criteria/weights quick-edit

### 2.2 Backend (Python / FastAPI)

#### 2.2.1 API Layer (FastAPI)

REST endpoints for all CRUD and query operations. WebSocket endpoint for chat streaming and processing progress. Full specification in Section 4.

#### 2.2.2 Service Layer

Three core services:

**RoleService**
- Create, read, update, delete roles
- Trigger criteria extraction from JD via LLM
- Manage criteria definitions and weights

**ResumeService**
- Handle PDF upload and storage
- Orchestrate the two-stage parsing pipeline (text extraction → LLM structuring)
- Trigger scoring pipeline
- Manage re-scoring when criteria change

**ChatService**
- Maintain conversation history per role
- Run the **agentic tool-use loop** (see Section 2.3): send the user's message + history to the LLM along with tool definitions; the LLM decides which tools to call, the service executes them, and the loop continues until the LLM produces a final response
- No hardcoded intent classification — the LLM handles intent, data retrieval, and response generation as a single reasoning process
- Return both a text response and optional UI mutation instructions (extracted from any action-tool calls the LLM made during the loop)

#### 2.2.3 LLM Abstraction Layer

```python
class LLMProvider(ABC):
    """Interface for swappable LLM providers."""

    @abstractmethod
    async def parse_resume(self, raw_text: str) -> StructuredProfile:
        """Extract structured profile from raw resume text."""
        ...

    @abstractmethod
    async def extract_criteria(self, job_description: str) -> list[Criterion]:
        """Propose scoring criteria from a job description."""
        ...

    @abstractmethod
    async def score_candidate(
        self,
        profile: StructuredProfile,
        job_description: str,
        criteria: list[Criterion],
    ) -> CandidateScores:
        """Score a candidate across all criteria in a single call."""
        ...

    @abstractmethod
    async def chat(
        self,
        message: str,
        conversation_history: list[Message],
        tools: list[ToolDefinition],
        system_prompt: str,
    ) -> LLMResponse:
        """Single LLM call that may return text, tool calls, or both.
        
        This is NOT the loop itself — it's one turn of the conversation.
        The ChatService orchestrates the loop by calling this repeatedly
        until no more tool calls are requested.
        """
        ...
```

**Initial implementation**: `AnthropicProvider` using Claude Sonnet via the Anthropic API.

Adding a new provider (e.g., OpenAI) means implementing this interface — no changes to services or API layer. The `chat` method maps directly to the provider's native tool-use API (e.g., Anthropic's tool_use content blocks, OpenAI's function_calling).

**Key design choice**: the `LLMProvider.chat()` method handles a *single LLM turn*, not the full loop. The agentic loop lives in `ChatService`, which calls `provider.chat()` repeatedly. This means the loop logic is provider-agnostic — if a local model needs a different looping strategy (e.g., fewer iterations, constrained tool set), you adjust the service, not the provider.

### 2.3 Agentic Chat Loop

The conversational interface uses an agentic tool-use pattern. Instead of hardcoded intent classification and routing, the LLM is given tools that let it query and act on the candidate data. It decides what information it needs, calls the appropriate tools, reads the results, and either calls more tools or produces a final response.

#### 2.3.1 Loop Flow

```
User sends message via WebSocket
         │
         ▼
┌────────────────────────────────────────────────┐
│  ChatService.handle_message()                  │
│                                                │
│  1. Load conversation history from DB          │
│  2. Build system prompt (role context, JD,     │
│     current highlight state)                   │
│  3. Enter agentic loop:                        │
│     ┌─────────────────────────────────────┐    │
│     │                                     │    │
│     │  Call LLMProvider.chat() with:      │    │
│     │    - messages (history + new)       │    │
│     │    - tool definitions              │    │
│     │    - system prompt                 │    │
│     │              │                      │    │
│     │              ▼                      │    │
│     │  LLM responds with either:         │    │
│     │    A) tool_calls → execute tools    │    │
│     │       in parallel, append results   │    │
│     │       to messages, LOOP BACK ──────►│    │
│     │    B) text response → EXIT LOOP     │    │
│     │                                     │    │
│     │  Safety: max 5 iterations           │    │
│     └─────────────────────────────────────┘    │
│                                                │
│  4. Extract UI mutations from any action-tool  │
│     calls made during the loop                 │
│  5. Save assistant response + tool calls       │
│     to chat history                            │
│  6. Stream response + mutations to client      │
│     via WebSocket                              │
└────────────────────────────────────────────────┘
```

#### 2.3.2 Tool Definitions

Tools are defined in a dedicated module (`app/tools/`), separate from both the LLM provider and the services. Each tool has a definition (name, description, parameter schema) and an executor function that runs against the database/services.

Tools fall into two categories:

**Data Retrieval Tools** — read-only queries over the candidate pool:

```python
# Get ranked candidate list with structured profiles
get_candidates(
    role_id: str,
    limit: int = 50,          # max candidates to return
    offset: int = 0,          # pagination
    sort_by: str = "rank",    # "rank", "name", or a criterion name
    sort_order: str = "asc",
) -> list[CandidateSummary]
# Returns: id, name, aggregate_score, rank, skills[], 
#          current_title, years_experience, education_summary

# Get full structured profile for one candidate
get_candidate_detail(
    candidate_id: str,
) -> StructuredProfile
# Returns: complete parsed profile with all fields

# Get raw resume text for deep-dive questions
get_candidate_raw_text(
    candidate_id: str,
) -> str
# Returns: full extracted text from the resume PDF

# Get per-criterion scores and rationales for a candidate
get_candidate_scores(
    candidate_id: str,
) -> list[CriterionScore]
# Returns: criterion_name, score, weight, rationale for each

# Search candidates by field values
search_candidates(
    role_id: str,
    field: str,               # "skills", "companies", "titles", "education", "location", "text"
    query: str,               # search term
) -> list[CandidateMatch]
# Returns: matching candidates with relevant excerpts

# Compute aggregate statistics over the candidate pool
compute_stats(
    role_id: str,
    stat_type: str,           # "count", "average", "distribution", "percentage"
    field: str,               # field to compute over
    condition: str | None,    # optional filter (e.g., "skills contains Python")
) -> StatResult
# Returns: computed statistic with breakdown

# Get current UI state (which candidates are highlighted, current sort)
get_ui_state(
    role_id: str,
) -> UIState
# Returns: highlighted_candidate_ids[], current_sort_field, current_sort_order
```

**Action Tools** — mutate the UI state:

```python
# Highlight candidates (additive — does not clear existing highlights)
set_highlights(
    role_id: str,
    candidate_ids: list[str],     # candidates to add to highlights
) -> HighlightResult
# Returns: confirmation + updated highlight list

# Remove highlights from specific candidates
remove_highlights(
    role_id: str,
    candidate_ids: list[str],     # candidates to un-highlight
) -> HighlightResult

# Clear all highlights
clear_highlights(
    role_id: str,
) -> HighlightResult

# Re-sort the candidate list
set_sort(
    role_id: str,
    field: str,                   # "aggregate", criterion name, or profile field
    order: str = "desc",          # "asc" or "desc"
) -> SortResult

# Reset all UI mutations to original ranking
reset_ui(
    role_id: str,
) -> ResetResult
```

#### 2.3.3 How Tool Categories Map to Query Types

| User Query Example | Tools the LLM Would Call |
|--------------------|--------------------------|
| "Highlight candidates with Python experience" | search_candidates(field="skills", query="Python") → set_highlights(candidate_ids=...) |
| "From those, highlight ones in California" | get_ui_state() → search_candidates(field="location", query="California") → intersect with current highlights → set_highlights() |
| "What percentage have a CS degree?" | compute_stats(stat_type="percentage", field="education", condition="degree contains Computer Science") |
| "Tell me about candidate #3's leadership experience" | get_candidate_raw_text(candidate_id=...) → LLM reads and responds |
| "Compare the top 3 on communication skills" | get_candidates(limit=3) → get_candidate_raw_text() × 3 → LLM compares |
| "Why is candidate #7 ranked so low?" | get_candidate_scores(candidate_id=...) → LLM explains |
| "Prioritize startup experience" | get_candidates() → search_candidates(field="companies"/"text", query="startup") → set_sort() or set_highlights() |

#### 2.3.4 System Prompt Structure

The system prompt provides the LLM with role context and behavioral instructions. It does NOT include candidate data (that comes via tools).

```
You are an HR analysis assistant for the role: {role_title}.

Job Description:
{job_description}

Scoring Criteria:
{criteria_list_with_weights}

Current candidate pool: {candidate_count} applicants.

You have tools to query candidate data, compute statistics, and 
control the UI (highlights, sorting). Use them to answer the HR 
professional's questions.

Behavioral rules:
- When asked to highlight or filter, use set_highlights (additive/soft).
  Never claim to "remove" or "hide" candidates — only highlight matches.
- For filter chaining ("from those..."), call get_ui_state first to 
  see current highlights, then intersect.
- For statistics, use compute_stats when possible rather than fetching 
  all candidates and counting manually.
- For deep dives, fetch raw resume text — structured profiles may miss 
  nuance.
- Keep responses concise and actionable.
- When providing scores or rankings, always reference the specific 
  criteria.
```

#### 2.3.5 Extracting UI Mutations from the Loop

During the agentic loop, the LLM may call action tools (set_highlights, set_sort, etc.). The ChatService intercepts these calls and accumulates them into the `UIMutations` response object. The action tools execute against a lightweight in-memory UI state store (persisted to DB) so that `get_ui_state` reflects changes made within the same loop iteration.

```python
async def handle_message(self, role_id: str, user_message: str) -> ChatResponse:
    history = self.load_history(role_id)
    tools = self.tool_registry.get_all_definitions()
    system_prompt = self.build_system_prompt(role_id)
    
    messages = [*history, {"role": "user", "content": user_message}]
    accumulated_mutations = UIMutations()
    
    for iteration in range(MAX_ITERATIONS):  # safety cap: 5
        llm_response = await self.llm_provider.chat(
            messages=messages,
            tools=tools,
            system_prompt=system_prompt,
        )
        
        if not llm_response.has_tool_calls:
            # Final text response — exit loop
            break
        
        # Execute all requested tools in parallel
        tool_results = await asyncio.gather(*[
            self.tool_registry.execute(call) 
            for call in llm_response.tool_calls
        ])
        
        # Accumulate any UI mutations from action tools
        for call, result in zip(llm_response.tool_calls, tool_results):
            if call.name in ACTION_TOOLS:
                accumulated_mutations.merge(result.mutations)
        
        # Append tool calls and results to message history for next iteration
        messages.append(llm_response.as_message())
        messages.append({"role": "user", "content": format_tool_results(tool_results)})
    
    # Persist to chat history
    self.save_messages(role_id, user_message, llm_response.text, accumulated_mutations)
    
    return ChatResponse(
        content=llm_response.text,
        ui_mutations=accumulated_mutations if accumulated_mutations.has_changes else None,
    )
```

#### 2.3.6 Future-Proofing for Local Models

The agentic loop is designed to degrade gracefully when the LLM is less capable at tool use:

- **Tool count**: reduce the tool set for weaker models (e.g., merge search + stats into a single broader tool)
- **Iteration cap**: lower MAX_ITERATIONS for models that tend to loop unnecessarily
- **Fallback mode**: if a provider doesn't support tool use at all, the ChatService can fall back to a "pre-fetch" strategy — load all structured profiles into context and let the LLM reason over them directly (trading token cost for simplicity)
- **Tool definitions**: simpler parameter schemas for models that struggle with complex JSON arguments

All of this is configurable per-provider without changing the service layer.

#### 2.2.4 Resume Processing Pipeline

```
PDF Upload
    │
    ▼
┌─────────────────────────────────┐
│  Stage 1: Text Extraction       │
│                                 │
│  pdfplumber (layout-aware)      │
│    - Detects columns, tables    │
│    - Preserves reading order    │
│    - Extracts text with spatial │
│      positioning                │
│                                 │
│  If text extraction yields      │
│  little/no content:             │
│    → Tesseract OCR              │
│    → If OCR quality is poor:    │
│      → LLM Vision API fallback  │
│        (send page images)       │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│  Stage 2: LLM Structuring      │
│                                 │
│  Input: extracted raw text      │
│  Output: StructuredProfile JSON │
│    - name, contact_info         │
│    - experiences[]              │
│      (title, company, duration, │
│       start_date, end_date,     │
│       description)              │
│    - education[]                │
│      (degree, institution,      │
│       field, year)              │
│    - skills[]                   │
│    - certifications[]           │
│    - summary                    │
│    - confidence_scores{}        │
│      (per-section confidence)   │
│                                 │
│  Prompt instructs LLM to:      │
│    - Map messy text to schema   │
│    - Infer missing structure    │
│    - Flag low-confidence parses │
└───────────────┬─────────────────┘
                │
                ▼
        Store both raw text
        and structured profile
```

#### 2.2.5 Scoring Pipeline

```
For each candidate:
    │
    ▼
  Single LLM call with:
    - Job description
    - Criteria definitions + weights
    - Candidate's structured profile
    │
    ▼
  LLM returns (structured JSON):
    - Per-criterion score (e.g., 1-10)
    - Per-criterion brief rationale (1-2 sentences)
    - Overall fit summary
    │
    ▼
  Backend computes:
    - Weighted aggregate score
    - Rank position
    │
    ▼
  Store scores and rationales
```

Candidates are scored independently (one LLM call per candidate), enabling parallel processing.

---

## 3. Data Model

### 3.1 Entity Relationship

```
Role (1) ──────── (N) Candidate
  │                      │
  │                      │
  ├── (N) Criterion      ├── StructuredProfile (1:1)
  │                      ├── RawResumeText (1:1)
  │                      ├── (N) CriterionScore
  │                      └── AggregateScore (1:1)
  │
  └── (N) ChatMessage
```

### 3.2 Table Definitions

**roles**

| Column          | Type     | Description                          |
|-----------------|----------|--------------------------------------|
| id              | UUID     | Primary key                          |
| title           | TEXT     | Role title                           |
| job_description | TEXT     | Full JD text                         |
| created_at      | DATETIME | Creation timestamp                   |
| updated_at      | DATETIME | Last modification timestamp          |

**criteria**

| Column      | Type    | Description                              |
|-------------|---------|------------------------------------------|
| id          | UUID    | Primary key                              |
| role_id     | UUID    | FK → roles                               |
| name        | TEXT    | Criterion name (e.g., "Python proficiency") |
| description | TEXT    | What this criterion evaluates            |
| weight      | FLOAT   | Relative weight (default 1.0)            |
| source      | TEXT    | "auto" (system-proposed) or "manual"     |
| order_index | INT     | Display order                            |

**candidates**

| Column             | Type     | Description                          |
|--------------------|----------|--------------------------------------|
| id                 | UUID     | Primary key                          |
| role_id            | UUID     | FK → roles                           |
| name               | TEXT     | Extracted candidate name             |
| raw_text           | TEXT     | Full extracted resume text           |
| structured_profile | JSON     | Parsed profile (see schema above)    |
| parse_confidence   | JSON     | Per-section confidence scores        |
| pdf_filename       | TEXT     | Original uploaded filename           |
| pdf_blob           | BLOB     | Original PDF binary (for re-processing) |
| aggregate_score    | FLOAT    | Weighted total score                 |
| rank               | INT      | Current rank position                |
| created_at         | DATETIME | Upload timestamp                     |

**criterion_scores**

| Column        | Type  | Description                            |
|---------------|-------|----------------------------------------|
| id            | UUID  | Primary key                            |
| candidate_id  | UUID  | FK → candidates                        |
| criterion_id  | UUID  | FK → criteria                          |
| score         | FLOAT | Numeric score (e.g., 1-10)             |
| rationale     | TEXT  | Brief justification for this score     |

**chat_messages**

| Column       | Type     | Description                            |
|--------------|----------|----------------------------------------|
| id           | UUID     | Primary key                            |
| role_id      | UUID     | FK → roles                             |
| role_enum    | TEXT     | "user" or "assistant"                  |
| content      | TEXT     | Message text                           |
| ui_mutations | JSON     | Optional: highlight/sort instructions  |
| created_at   | DATETIME | Timestamp                              |

---

## 4. API Specification

### 4.1 REST Endpoints

**Roles**

| Method | Path                         | Description                        |
|--------|------------------------------|------------------------------------|
| POST   | /api/roles                   | Create a role (title + JD)         |
| GET    | /api/roles                   | List all roles                     |
| GET    | /api/roles/{role_id}         | Get role details                   |
| PUT    | /api/roles/{role_id}         | Update role (title, JD)            |
| DELETE | /api/roles/{role_id}         | Delete role and all associated data|

**Criteria**

| Method | Path                                      | Description                        |
|--------|-------------------------------------------|------------------------------------|
| POST   | /api/roles/{role_id}/criteria/extract      | Trigger LLM criteria extraction from JD |
| GET    | /api/roles/{role_id}/criteria              | List criteria for a role           |
| POST   | /api/roles/{role_id}/criteria              | Add a manual criterion             |
| PUT    | /api/roles/{role_id}/criteria/{id}         | Update criterion (name, description, weight) |
| DELETE | /api/roles/{role_id}/criteria/{id}         | Remove a criterion                 |

**Candidates / Resumes**

| Method | Path                                        | Description                              |
|--------|---------------------------------------------|------------------------------------------|
| POST   | /api/roles/{role_id}/candidates/upload       | Upload PDF resumes (multipart, batch)    |
| GET    | /api/roles/{role_id}/candidates              | List candidates with scores, ranked      |
| GET    | /api/roles/{role_id}/candidates/{id}         | Get full candidate detail (profile + scores + raw text) |
| DELETE | /api/roles/{role_id}/candidates/{id}         | Remove a candidate                       |

**Scoring**

| Method | Path                                        | Description                              |
|--------|---------------------------------------------|------------------------------------------|
| POST   | /api/roles/{role_id}/score                   | Trigger (re-)scoring of all candidates   |
| GET    | /api/roles/{role_id}/candidates/{id}/scores  | Get per-criterion scores + rationales    |

**Chat**

| Method | Path                                  | Description                              |
|--------|---------------------------------------|------------------------------------------|
| GET    | /api/roles/{role_id}/chat/history     | Get chat history for a role              |
| DELETE | /api/roles/{role_id}/chat/history     | Clear chat history                       |
| POST   | /api/roles/{role_id}/chat/reset       | Reset UI mutations (highlights, re-sorts)|

Chat messages themselves are sent/received via WebSocket (see below).

### 4.2 WebSocket Endpoints

**Chat** — `ws://host/ws/roles/{role_id}/chat`

```
Client sends:
{
    "type": "chat_message",
    "content": "Highlight candidates with Python experience"
}

Server sends (during agentic loop — tool execution status):
{
    "type": "tool_status",
    "iteration": 1,
    "tool_name": "search_candidates",
    "status": "executing"      // "executing" | "complete"
}

Server sends (during agentic loop — optional, for transparency):
{
    "type": "tool_status",
    "iteration": 1,
    "tool_name": "search_candidates",
    "status": "complete",
    "summary": "Found 5 candidates with Python skills"  // human-readable summary
}

Server streams (final response):
{
    "type": "chat_token",
    "token": "Based"           // streamed token-by-token
}
...
{
    "type": "chat_complete",
    "content": "Full response text",
    "ui_mutations": {          // optional, present when chat drives UI changes
        "highlights": {
            "add": ["candidate-uuid-1", "candidate-uuid-3"],
            "remove": []
        },
        "re_sort": null        // or { "field": "criterion-name", "order": "desc" }
    }
}
```

The `tool_status` messages let the frontend show a "thinking" indicator with context (e.g., "Searching candidates..." or "Computing statistics...") while the agentic loop runs. Only the final LLM response is streamed token-by-token.

**Processing Progress** — `ws://host/ws/roles/{role_id}/progress`

```
Server sends:
{
    "type": "progress",
    "stage": "parsing",         // "parsing" | "scoring"
    "current": 5,
    "total": 12,
    "candidate_name": "Jane Doe",
    "status": "complete"        // "in_progress" | "complete" | "error"
}
```

### 4.3 Chat Response Structure

The ChatService returns both text and optional UI instructions. This separation lets the frontend decide how to render mutations while keeping the API clean for external consumers (who may ignore the ui_mutations field).

```python
@dataclass
class ChatResponse:
    content: str                   # The text response to display in chat
    ui_mutations: UIMutations | None  # Optional instructions for the frontend

@dataclass
class UIMutations:
    highlights: HighlightAction | None
    re_sort: ReSortAction | None

@dataclass
class HighlightAction:
    add: list[UUID]        # Candidate IDs to highlight
    remove: list[UUID]     # Candidate IDs to un-highlight

@dataclass
class ReSortAction:
    field: str             # Criterion name or "aggregate"
    order: str             # "asc" or "desc"
```

---

## 5. Technology Stack Summary

| Layer              | Technology                     | Purpose                         |
|--------------------|--------------------------------|---------------------------------|
| Frontend           | React + Vite                   | SPA, static client              |
| HTTP framework     | FastAPI                        | REST + WebSocket, async support |
| Database           | SQLite                         | Persistence, single-file        |
| ORM / DB access    | SQLAlchemy (or raw SQL)        | Database interaction            |
| PDF text extraction| pdfplumber                     | Layout-aware text extraction    |
| OCR                | Tesseract (pytesseract)        | Scanned PDF fallback            |
| LLM provider       | Anthropic API (Claude Sonnet)  | All LLM tasks                   |
| LLM SDK            | anthropic (Python SDK)         | API client with native tool-use support |
| Orchestration      | Custom agentic loop (no framework) | Tool-use loop in ChatService  |

---

## 6. Key Design Principles

1. **API-first**: Every feature is an API endpoint. The frontend is one client among potentially many.
2. **Provider-swappable LLM**: The abstraction layer means switching from Anthropic to OpenAI (or any other provider) is a single new class implementation with zero changes to business logic.
3. **Hybrid data model**: Structured profiles for fast querying and stats; raw text for deep dives and edge cases. Neither alone is sufficient.
4. **Agentic chat, not hardcoded routing**: The LLM decides what data it needs and how to act via tool use. No brittle intent classifier in application code. The system's conversational capabilities grow by adding tools, not by writing more if/else branches.
5. **Loop in service, turn in provider**: The agentic loop lives in `ChatService` (provider-agnostic). The `LLMProvider.chat()` method handles a single LLM turn. This separation lets you adjust loop behavior (iteration caps, tool subsets, fallback strategies) per-provider without duplicating orchestration logic.
6. **Tools as a contract**: Tool definitions are the interface between the LLM and the application data. They are defined in a dedicated module, versioned and modifiable independently of both the LLM provider and the services. Adding a new capability to the chat = adding a new tool.
7. **Confidence-aware parsing**: The system acknowledges its own uncertainty in resume parsing via per-section confidence scores, preventing silent errors from propagating into rankings.
8. **Stateless frontend**: All state lives in the backend database. The frontend can be refreshed, closed, or replaced without data loss.

---

## 7. Directory Structure (Proposed)

```
agentic-ats/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app entry point
│   │   ├── config.py                # Settings, env vars, LLM provider config
│   │   ├── database.py              # SQLite connection, schema init
│   │   ├── models/                  # SQLAlchemy models or dataclasses
│   │   │   ├── role.py
│   │   │   ├── candidate.py
│   │   │   ├── criterion.py
│   │   │   └── chat.py
│   │   ├── schemas/                 # Pydantic request/response schemas
│   │   │   ├── role.py
│   │   │   ├── candidate.py
│   │   │   ├── criterion.py
│   │   │   └── chat.py
│   │   ├── api/                     # Route handlers
│   │   │   ├── roles.py
│   │   │   ├── candidates.py
│   │   │   ├── criteria.py
│   │   │   ├── chat.py
│   │   │   └── websocket.py
│   │   ├── services/                # Business logic
│   │   │   ├── role_service.py
│   │   │   ├── resume_service.py
│   │   │   └── chat_service.py      # Owns the agentic loop
│   │   ├── tools/                   # Chat tool definitions + executors
│   │   │   ├── registry.py          # Tool registry: loads definitions, dispatches execution
│   │   │   ├── definitions.py       # Tool schemas (name, description, parameters)
│   │   │   ├── data_tools.py        # Executors: get_candidates, search, stats, etc.
│   │   │   └── action_tools.py      # Executors: set_highlights, set_sort, reset, etc.
│   │   ├── llm/                     # LLM abstraction + providers
│   │   │   ├── base.py              # LLMProvider ABC
│   │   │   ├── anthropic_provider.py
│   │   │   └── prompts/             # Prompt templates
│   │   │       ├── parse_resume.py
│   │   │       ├── extract_criteria.py
│   │   │       ├── score_candidate.py
│   │   │       └── chat_system.py   # System prompt for agentic chat
│   │   └── pipeline/                # Resume processing pipeline
│   │       ├── text_extractor.py    # pdfplumber + Tesseract
│   │       └── ocr.py
│   ├── tests/
│   ├── requirements.txt
│   └── README.md
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── RoleList/
│   │   │   ├── RoleSetup/
│   │   │   ├── Workspace/
│   │   │   │   ├── CandidateList/
│   │   │   │   ├── ChatPanel/
│   │   │   │   └── CriteriaEditor/
│   │   │   └── common/
│   │   ├── services/                # API client functions
│   │   │   └── api.js
│   │   ├── hooks/                   # WebSocket hooks, state management
│   │   └── utils/
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   └── README.md
├── docs/
│   ├── v1_requirements.md
│   └── v1_architecture.md
└── README.md
```
