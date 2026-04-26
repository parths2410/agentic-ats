# Milestone 5 — Polish & Edge Cases — sub-plan

Source of truth: `docs/v1_implementation_plan.md` (Milestone 5 section).

## Scope decisions (driven by what's already built and what realistically
matters before shipping v1)

The implementation plan calls out several polish items. Some are already
satisfied by earlier milestones; the ones below are the gaps that actually
need work.

### Already covered earlier (no new work)

- Tesseract OCR fallback for sparse PDFs — `pipeline/text_extractor.py`.
- Corrupt/unreadable PDF resilience — `extract_text` swallows pdfplumber
  errors; ResumeService writes a candidate row with `status="error"` rather
  than crashing the batch.
- Adding more resumes to existing roles — UploadZone is already mounted on
  the role edit view as well as the new-role view. The endpoint is the
  same; nothing role-state-aware to add.
- Re-scoring when criteria change — `POST /api/roles/{id}/score` exists and
  the workspace surfaces a "Re-score all" button.
- Frontend chat reconnection — out of scope for v1; the WS hook surfaces an
  error and the user can refresh.
- Top-bar role switcher — there is already a navigable Roles list; in this
  single-process v1 we keep it as a click-back rather than a dropdown.

## Steps

### Step 1 — Re-scoring is triggered automatically when criteria change

The plan asks for "mark scores as stale when criteria are edited." Today
criteria can change without scores updating. We mark candidates as `stale`
when criteria are added/edited/deleted, and surface a "scores are stale"
banner with the existing Re-score button.

- Add a `stale_scores: bool` column on candidates with an in-place
  migration (`_apply_inplace_migrations`).
- After any criterion create/update/delete via the API, mark all of the
  role's complete candidates `stale_scores=True`.
- After a successful score persist, set `stale_scores=False`.
- Surface `stale_scores` in the candidate summary schema.
- Frontend: show a "Scores are out of date — re-score to update rankings."
  banner when any candidate has stale scores.
- Tests: backend unit + API tests; frontend Workspace test.

### Step 2 — LLM API failures: retry with backoff

`AnthropicProvider` currently surfaces transient errors as 502s and the
batch loop marks candidates as `error`. Add a tiny retry-with-exponential-
backoff helper around the SDK calls so a single rate-limit blip doesn't
nuke a whole upload.

- `app/llm/anthropic_provider.py`: add `_with_retry` helper, wrap the three
  message.create calls, retry up to 3 times on
  `anthropic.RateLimitError`/`APIConnectionError`/`InternalServerError`.
- Tests: `tests/test_anthropic_retry.py`.

### Step 3 — Frontend UX polish

- ChatPanel auto-scroll already exists. Add Shift+Enter newline behavior
  (Enter alone submits) — already implemented; just add the test.
- Confirmation dialog for role deletion (RoleList already calls confirm —
  we replace the native `confirm` with an inline ConfirmDialog component).
  v1: keep `confirm()` for simplicity but ensure the message is clear.
  This step focuses instead on:
  - Empty-state hint in Workspace when no candidates.
  - Empty-state hint in RoleSetup when no criteria.
  - Per-section parse confidence pills on the candidate detail card.
- Tests: extend Workspace + ChatPanel tests.

### Step 4 — Final coverage sweep

- Run the full backend + frontend coverage. If either dips below 65%, add
  more tests for the lines flagged as uncovered.
- Save the reports to `docs/coverage/{backend,frontend}_milestone_5/`.

## Verification

- Backend: pytest --cov passes ≥65%.
- Frontend: vitest run --coverage passes ≥65%.
- Manual end-to-end walkthrough per the implementation plan's "verification"
  section: create a role, upload resumes (include one bad PDF), edit
  criteria → see stale banner → re-score → ranking updates, chat through
  the UI mutations, refresh the browser → state restored.
