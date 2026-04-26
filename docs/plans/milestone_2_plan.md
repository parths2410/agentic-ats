# Milestone 2 — Resume Upload + Parsing + Scoring (retroactive plan)

Source of truth for scope: `docs/v1_implementation_plan.md` (Milestone 2).

## Goal

End-to-end resume pipeline: upload PDFs, extract text, parse into a
StructuredProfile via the LLM, score against the role's criteria, surface a
ranked candidate list with per-criterion rationales. First "usable" version.

## What was built

### Backend — pipeline

- `app/pipeline/text_extractor.py` — `extract_text(pdf_bytes)`. Primary
  extractor is pdfplumber. Fallback is Tesseract OCR via
  `page.to_image() → pytesseract.image_to_string`, but only if pdfplumber
  returns less than ~80 characters (image-based PDF). Degrades gracefully
  when OCR system binaries are missing.
- `app/pipeline/progress.py` — single-process pub/sub keyed by `role_id`.
  `subscribe(role_id) → asyncio.Queue` and `publish(role_id, event)`. The
  WebSocket endpoint subscribes; the resume service publishes per-stage
  events.

### Backend — LLM

- `app/llm/base.py` — extended with `parse_resume` and `score_candidate` ABCs.
- `app/llm/prompts/parse_resume.py` — prompt + JSON schema for the
  StructuredProfile (name, contact_info, summary, experiences, education,
  skills, certifications, confidence_scores).
- `app/llm/prompts/score_candidate.py` — 1–10 anchor scale, mandatory
  rationale per criterion, strict JSON. Explicitly forbids appending weight
  parens to criterion_name (a guardrail added after seeing the LLM produce
  `"Backend Engineering Experience (weight 1.0)"` during testing).
- `app/llm/anthropic_provider.py` — `_call_json` helper (single message
  call, JSON-tolerant parsing, surfaces `stop_reason`); `parse_resume`
  filling defensive defaults; `score_candidate` clamping scores to [1, 10],
  dropping malformed entries, returning `{scores, overall_summary}`.

### Backend — service layer

- `app/services/resume_service.py` — `ResumeService` orchestrating the full
  pipeline:
  - `create_candidates(role_id, files)` stores PDF bytes + filename, creates
    candidate rows with `status="pending"`.
  - `process_candidates_async(role_id, ids)` snapshots role + criteria,
    fans out one task per candidate via `asyncio.gather`, publishes batch
    + per-stage progress events, recomputes ranks at the end.
  - `_process_one` runs extract → parse → score → persist; sets
    `status="error"` with `error_message` on failure.
  - `_persist_scores` normalizes criterion names (strips trailing
    parentheticals like "(weight 1.0)") before matching, and explicitly
    marks `status="error"` if zero criteria matched, instead of silently
    storing a complete-but-empty result.
  - `rescore_role(role_id)` re-scores any candidate that already has a
    structured profile, then re-ranks.
  - `_recompute_ranks` orders candidates by aggregate desc and assigns rank.
  - `candidates_for_role(db, role_id)` ordered fetch helper used by the API.

### Backend — schemas + API

- `app/schemas/candidate.py` — `CandidateSummary`, `CandidateDetail`,
  `CriterionScoreRead`, `UploadResponse`.
- `app/api/candidates.py` — `POST /roles/{id}/candidates/upload` (multipart,
  rejects non-PDFs, kicks off background processing via
  `asyncio.create_task`), plus `GET` list, `GET` detail, `GET` scores,
  `DELETE` for a single candidate.
- `app/api/scoring.py` — `POST /roles/{id}/score` triggers a background
  re-score for the role.
- `app/api/websocket.py` — `WS /ws/roles/{id}/progress` — accepts the
  socket, sends a `ready` event, then forwards `progress.subscribe()`
  events as JSON until disconnect.
- `app/main.py` — wired in candidates / scoring / websocket routers.
- `requirements.txt` — `python-multipart` for FastAPI file uploads.

### Backend — schema migration

- `app/models/candidate.py` — added `status` (default `pending`) and
  `error_message` (nullable) columns.
- `app/database.py` — `_apply_inplace_migrations()` runs after `create_all`
  and `ALTER TABLE`s the new candidate columns onto an existing SQLite file
  if they aren't already there. Lightweight stand-in for Alembic given v1
  scope and the existing dev DB.

### Frontend

- `src/services/api.js` — added `api.candidates.{list,get,scores,delete,upload}`,
  `api.scoring.rescore`, and `api.ws.progress(roleId)`.
- `src/hooks/useProgress.js` — connects to `/ws/roles/{id}/progress`,
  tracks `{batch, perCandidate}` state for the upload progress indicator.
- `src/components/RoleSetup/UploadZone.jsx` — drag-and-drop or click-to-pick
  PDF upload, multi-file staging list with per-file remove, upload button.
- `src/components/RoleSetup/RoleSetup.jsx` — added the upload zone, the
  "Open Workspace →" link, and a progress banner driven by `useProgress`.
- `src/components/Workspace/Workspace.jsx` — full ranked candidate view:
  rank, name, status badge, aggregate score, mini per-criterion score
  pills, expand/collapse for the detailed profile + per-criterion
  rationale, delete + re-score actions, header summary
  (`{N}/{N} scored · {N} criteria`), progress banner.
- `src/App.jsx` — replaced the placeholder `/workspace` route with
  `/roles/:roleId/workspace`.
- `src/styles.css` — upload zone, workspace layout, candidate cards,
  status badges, mini-score pills, expanded detail.

### Verification artifact

- `frontend/scripts/verify-m2.mjs` — Playwright script that creates a role,
  extracts criteria, uploads three sample resume PDFs, opens the workspace,
  waits for all candidates to reach `complete`/`error`, asserts ranks are
  sorted descending by aggregate, expands the top candidate.

## Verification (deliverable in plan)

End-to-end Playwright run with three resumes (strong / mid / mismatched):
ranking matches expectations (8.31 > 4.46 > 1.31 in the run captured), all
cards show 8 mini-scores, expanded view shows 8 rationale items, zero
console / network errors.

## Bugs surfaced + fixed during M2

- LLM occasionally returned criterion_name as
  `"Backend Engineering Experience (weight 1.0)"`. Two-part fix:
  (a) prompt tightening explicitly forbidding the suffix,
  (b) defensive name normalizer in `_persist_scores`.
- Silent-success bug: a scoring response that matched zero criteria was
  marking candidates `status="complete"` with no scores. Now correctly
  routes to `status="error"` with an explanatory message.

## Files attributed to this milestone

```
backend/app/api/candidates.py
backend/app/api/scoring.py
backend/app/api/websocket.py
backend/app/services/resume_service.py
backend/app/schemas/candidate.py
backend/app/llm/prompts/parse_resume.py
backend/app/llm/prompts/score_candidate.py
backend/app/pipeline/text_extractor.py
backend/app/pipeline/progress.py
backend/app/main.py                       (now imports candidates/scoring/ws)
backend/app/models/candidate.py           (added status + error_message)
backend/app/database.py                   (added in-place migration helper)
backend/app/llm/base.py                   (added parse_resume + score_candidate)
backend/app/llm/anthropic_provider.py     (added parse_resume + score_candidate)
backend/requirements.txt                  (now: python-multipart)
frontend/src/components/RoleSetup/UploadZone.jsx
frontend/src/components/Workspace/Workspace.jsx       (full impl)
frontend/src/components/RoleSetup/RoleSetup.jsx       (now: upload + workspace link)
frontend/src/services/api.js              (now: candidates + scoring + ws)
frontend/src/hooks/useProgress.js
frontend/src/styles.css                   (now: upload + workspace styles)
frontend/src/App.jsx                      (now: /roles/:roleId/workspace)
frontend/scripts/verify-m2.mjs
docs/plans/milestone_0_plan.md
docs/plans/milestone_1_plan.md
docs/plans/milestone_2_plan.md
```
