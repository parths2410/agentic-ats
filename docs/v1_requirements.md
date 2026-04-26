# Job Application Ranking & Analysis Tool — v1 Requirements Specification

## 1. Overview

A web application that enables an HR professional to create roles, define job descriptions, upload applicant resumes (PDF), receive a ranked and scored candidate list, and interact with the candidate pool through a natural language conversational interface.

This document defines the scope, objectives, and requirements for the first iteration (v1) of the system.

---

## 2. Objectives

1. **Reduce time-to-shortlist** — Automate the initial screening of dozens of resumes against a job description, producing a ranked candidate list with transparent, per-criteria scoring.
2. **Enable flexible exploration** — Provide a conversational interface that lets the HR professional query, filter, compare, and analyze the applicant pool without learning a query language or navigating complex UI.
3. **Maintain transparency** — Every ranking decision should be explainable. Scores are broken into components, and justifications are available on demand.
4. **Stay provider-agnostic** — Abstract the LLM layer so that different providers (OpenAI, Anthropic, Google, etc.) can be swapped or benchmarked without system changes.

---

## 3. Users & Usage Context

- **Primary user**: A single HR professional operating the system at a time.
- **No authentication or multi-tenancy** in v1.
- **Scale**: A few dozen resumes per role; multiple roles tracked simultaneously.
- **Session persistence**: State (roles, parsed resumes, scores, conversation history) persists across browser sessions via a backend data store. Closing and reopening the app should restore the last state.

---

## 4. Functional Requirements

### 4.1 Role Management

| ID     | Requirement |
|--------|-------------|
| RM-01  | The user can create a new role with a title and a job description (free-text input). |
| RM-02  | The system auto-extracts scoring criteria from the job description and proposes them to the user. |
| RM-03  | The user can add, remove, edit, and reweight the proposed scoring criteria before (or after) processing resumes. |
| RM-04  | The user can view and switch between multiple open roles. |
| RM-05  | When working within a role, all interactions (ranking, chat, filters) are scoped exclusively to that role's applicants. |
| RM-06  | The user can edit the job description and re-trigger criteria extraction and scoring. |

### 4.2 Resume Ingestion & Processing (Hybrid Pipeline)

| ID     | Requirement |
|--------|-------------|
| RI-01  | The user can upload multiple PDF resumes in a batch for a given role. |
| RI-02  | The system handles text-based PDFs, scanned/image-based PDFs (via OCR), and mixed-format PDFs. |
| RI-03  | On upload, the system **eagerly** parses each resume into a structured profile: name, contact info, skills, work experience (titles, companies, durations), education, certifications, and other extractable fields. |
| RI-04  | The raw extracted text of each resume is also stored alongside the structured profile (hybrid model) for deep-dive queries that may need information not captured in the structured parse. |
| RI-05  | Parsing and scoring progress is communicated to the user (progress indicator). |
| RI-06  | The user can add additional resumes to an existing role after initial upload. |

### 4.3 Ranking & Scoring

| ID     | Requirement |
|--------|-------------|
| RS-01  | Each candidate receives a **per-criteria component score** based on the role's scoring criteria. |
| RS-02  | An **aggregate score** is computed from the weighted combination of component scores, using the weights defined (or defaulted) for each criterion. |
| RS-03  | Scoring considers both structured fields (years of experience, degree level, specific skills) and semantic matching (relevance of experience, transferable skills, context). |
| RS-04  | On request (via conversation), the system provides a **justification description** for any individual score or ranking position. |
| RS-05  | If the user modifies criteria or weights, the system re-scores and re-ranks accordingly. |

### 4.4 Conversational Interface

#### 4.4.1 General Behavior

| ID     | Requirement |
|--------|-------------|
| CI-01  | A chat panel is presented alongside the ranked candidate list. |
| CI-02  | The chat maintains **session memory** — previous messages and their context are retained within the session and can be referenced. |
| CI-03  | The system **infers intent** from the user's natural language input and determines whether the query is a visual list mutation (highlight, re-sort) or a pure Q&A response. |
| CI-04  | An explicit **reset** command returns the list to its original ranking state, clearing all highlights and re-sorts applied via chat. |

#### 4.4.2 Supported Interaction Types

| ID     | Type | Description |
|--------|------|-------------|
| CI-05  | **Filtering (soft highlight)** | "Highlight candidates with startup experience" — visually distinguishes matching candidates without hiding anyone. |
| CI-06  | **Filter chaining** | "Now from those, highlight the ones in California" — applies additional highlights on top of existing ones. |
| CI-07  | **Re-ranking / re-sorting** | "Prioritize candidates who have ML experience" — reorders the list with adjusted emphasis. |
| CI-08  | **Aggregation / statistics** | "What percentage have a CS degree?" or "Average years of experience?" — pool-level analytics returned as text. |
| CI-09  | **Candidate deep dive** | "Tell me more about candidate #3's leadership experience" — pulls specific details from the candidate's raw resume text. |
| CI-10  | **Comparison** | "Compare the top 3 on communication skills" — side-by-side analysis. |
| CI-11  | **Score justification** | "Why is candidate #7 ranked so low?" — explains the scoring rationale. |

### 4.5 Data Persistence

| ID     | Requirement |
|--------|-------------|
| DP-01  | All roles, job descriptions, criteria, uploaded resumes (raw text + structured profiles), scores, and conversation history persist across browser sessions. |
| DP-02  | A lightweight backend data store (e.g., SQLite, PostgreSQL) manages persistence. |
| DP-03  | The user can delete a role and all its associated data. |

---

## 5. Non-Functional Requirements

### 5.1 Architecture

| ID     | Requirement |
|--------|-------------|
| NF-01  | **Backend**: Python-based, exposing a RESTful API. All functionality is accessible via the API — the frontend is one consumer, but external tools can also call the API directly. |
| NF-02  | **Frontend**: Lightweight — no overly complex framework. Should be simple to develop and iterate on. |
| NF-03  | **LLM abstraction layer**: Clean interfaces (`parse_resume`, `score_candidate`, `chat_query`) behind which the LLM provider can be swapped. The system should support experimenting with multiple providers. |
| NF-04  | **API-first**: The backend API is the system of record. The frontend consumes the same API that external tools would use. |

### 5.2 Performance

| ID     | Requirement |
|--------|-------------|
| NF-05  | Batch resume processing (parsing + scoring) for dozens of resumes may take seconds to minutes — a progress indicator is required. |
| NF-06  | Conversational responses should feel near-real-time (target: <5s for most queries, with streaming where possible). |

### 5.3 Constraints

| ID     | Requirement |
|--------|-------------|
| NF-07  | No authentication, authorization, or multi-tenancy in v1. |
| NF-08  | No compliance, bias auditing, GDPR, or data retention rules in v1. |
| NF-09  | LLM calls go to external API providers — data leaving the machine is acceptable for v1. |
| NF-10  | Single concurrent user assumed. |

---

## 6. Out of Scope (v1)

The following are explicitly deferred to future iterations:

- Multi-user collaboration and role-based access
- Candidate lifecycle tracking (interviewed, rejected, offered, notes)
- Authentication and authorization
- Compliance, bias detection, and audit logging
- Local/on-premise LLM deployment
- Email or calendar integrations
- Resume format support beyond PDF (e.g., Word, LinkedIn imports)
- Automated job posting or applicant intake (resumes are manually uploaded)

---

## 7. Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Resume processing model | Hybrid (eager parse + raw text storage) | Structured data enables fast filtering/stats; raw text enables deep dives without information loss. |
| LLM deployment | External API | Avoids infrastructure burden; quality is significantly better for reasoning-heavy tasks; cost is negligible at v1 scale. |
| List mutation model | Hybrid (Option C) | Chat can drive visual changes (highlights, re-sorts) or answer pure Q&A. User never loses the original ranked view — mutations are reversible and additive. |
| Highlight model | Soft highlights | Candidates are never hidden from the list — only visually distinguished. Preserves full visibility. |
| Criteria source | Auto-extracted + user-editable | System proposes criteria from JD; user can add/remove/edit/reweight. Balances automation with control. |
| Backend | Python, API-first | Per user preference. API-first design decouples frontend and enables external integrations. |
| Frontend | Lightweight, minimal complexity | Per user preference. Specific framework TBD in architecture phase. |
| Persistence | Backend data store | Sessions persist across browser close/reopen. |

---

## 8. Open Questions for Architecture Phase

1. **API design** — REST vs. REST + WebSocket (for streaming chat responses and progress updates)?
2. **Database choice** — SQLite (simpler, single-file) vs. PostgreSQL (more robust, but heavier setup)?
3. **Frontend framework** — Plain HTML/JS, React (lightweight with Vite), or something like Svelte/HTMX?
4. **LLM provider for initial implementation** — Start with one (which?) or wire up multiple from day one?
5. **Scoring pipeline granularity** — One LLM call per candidate per criterion, or batch criteria per candidate, or batch candidates per criterion?
6. **Chat context management** — How much of the candidate pool data goes into each chat LLM call? Full structured profiles, or a retrieval layer that selects relevant candidates first?
7. **OCR strategy** — Which library/service for scanned PDF handling (Tesseract, cloud OCR API, or LLM vision)?
