---
name: Milestone 7 Plan
description: UI Refresh — RoleSetup page redesign with tabbed layout, criteria rows, and resumes tab with split-view PDF modal
---

# Milestone 7 — UI Refresh: RoleSetup page

Milestone 6 covered the Roles list page. This milestone redesigns the
RoleSetup page (`/roles/new` and `/roles/:id`) into a tabbed structure
following the same Lever-inspired aesthetic. A future milestone covers
the Workspace.

## Decisions (locked-in from product discussion)

### Cross-cutting

- **Sticky page header above the tabs.** Left: role title (or "New role"
  for new). Right: `Open Workspace →` link (existing roles only).
  Hairline divider, then a sticky tab strip: `Basics · Criteria · Resumes`.
  Tab strip stays sticky while scrolling within a tab.
- **New-role flow.** Lands directly on the tabbed view with
  Criteria/Resumes locked until Basics is saved. No separate "create
  role" page.
- **Per-section save buttons.** Each tab has its own Save. No "save
  everything" global button. Save is disabled until something on the
  current tab is dirty.
- **Delete role stays only on the RoleList page.** No delete control
  inside RoleSetup (decided against).

### Basics tab

- Title input + Job Description textarea + Save button.
- Borderless / hairline-bordered inputs, generous spacing — no card
  chrome around fields.
- Save bottom-right, disabled until dirty.

### Criteria tab

- **Hairline-divider rows** replacing the bordered `CriterionCard`.
  Each row: name input + quiet AUTO/MANUAL marker + delete on top line;
  description textarea below; weight control beneath.
- **Weight: three segmented chips — Low / Medium / High** mapped to
  0.5 / 1.0 / 1.5. Slider removed.
- **AUTO/MANUAL marker:** small uppercase grey text, no pill background.
  Visible if you look, fades into the row otherwise.
- **Empty state hero:** centered "No criteria yet" + two buttons —
  `Extract from job description` (primary) and `Add manually` (secondary).
- **Extract from JD always available** in the populated state too —
  small secondary button in the tab toolbar. Re-clicking appends new
  proposals as drafts (does not replace existing criteria). No
  "JD changed" detection or banner.
- **Drag-handle reordering.** Small grip icon left of each row;
  reorder via drag. Persists `order_index`.

### Resumes tab

- **Upload zone at top** (multi-PDF, drag-drop or click).
- **List below in upload-time order, newest first.** Not rank-based —
  ranking lives in Workspace.
- Each row: candidate name (or filename) + filename · upload time on
  the left; aggregate score; status pill (`complete` / `parsing` /
  `error`); delete icon. Failed rows show the parse error inline.
- **Click a row → split-view modal**: 60% PDF iframe on left, 40% LLM
  output on right (aggregate banner, summary, parse confidence pills,
  per-criterion score breakdown with rationale and weight). Esc to
  close.
- Bottom of tab: `View full ranking →` link to Workspace.

## Steps

### Step 1 — Backend: PDF serving endpoint

The PDF blob is already stored in `candidate.pdf_blob`. We need an
endpoint to serve it.

- New route: `GET /api/roles/{role_id}/candidates/{candidate_id}/pdf`.
- Returns `application/pdf` with the blob bytes; uses
  `Content-Disposition: inline; filename="..."` so the browser can
  render it inside an iframe.
- 404 when role/candidate missing or candidate has no blob.
- Tests: happy path, missing candidate, missing blob, candidate
  belongs to a different role (404).

### Step 2 — Frontend: tab shell + Basics tab

- Sticky page header: role title (large), `Open Workspace →` link
  (existing only), hairline divider, sticky tab strip.
- Tab routing — query string (`?tab=criteria`) so reload preserves
  state and links can deep-link to a tab.
- Lock Criteria + Resumes tabs (visually disabled, tooltip "Save the
  role first") until the role exists.
- Basics tab: title input, JD textarea, Save button. Save disabled
  until something is dirty. On create, navigate to the new role's URL
  (replace) and unlock the other tabs.
- styles.css: tab strip + sticky header + form-field rules.
- Tests: header rendering, tab switch via query string, lock state for
  new role, Basics save (create + update), dirty tracking.

### Step 3 — Frontend: Criteria tab

- Replace `CriterionCard` with a flat row component (hairline divider,
  no card border).
- Three-tier weight chip group component (Low / Medium / High).
  Existing data uses arbitrary 0–2 floats — round to nearest tier on
  load (≤0.74 → Low, ≤1.24 → Medium, else High); save the canonical
  0.5 / 1.0 / 1.5.
- Quiet `AUTO` / `MANUAL` marker (uppercase grey text).
- Empty hero with `Extract from job description` (primary) +
  `Add manually` (secondary) buttons.
- Populated state: small toolbar above the list with
  `+ Add criterion` and `Extract from JD` (secondary) buttons; Save
  button bottom-right.
- Drag-handle reordering using `@dnd-kit/sortable` (small, modern).
  Persist `order_index` on save.
- Tests: row rendering, weight tier selection (mapping both ways),
  extract appending, empty-state buttons, save criteria, drag reorder
  (shuffle list state without DOM-level dnd; assert state shape).

### Step 4 — Frontend: Resumes tab

- Reuse `UploadZone` (restyle for airier look — lighter border, more
  padding) with the upload button below.
- Status line: "X of Y processed · N error(s)" + `Re-score all`
  secondary button.
- Resume list: hairline-divider rows in upload-time order, newest
  first. Row cells: name+filename+time on left, aggregate score,
  status pill, delete icon. Inline error message for failed rows.
- Click row → opens the split-view modal (Step 5).
- Bottom: `View full ranking →` link to Workspace.
- Polls candidate summaries while a batch is active (existing
  `useProgress` hook covers the batch state; add a simple list
  refresh while `batch.active` is true).
- Tests: list rendering with mixed statuses, click-to-open modal call,
  delete with confirm, sort order is upload-time-desc, error inline.

### Step 5 — Frontend: split-view modal

- New `<CandidateModal>` component. Centered overlay, dim backdrop,
  close on Esc or click outside.
- Left pane (60%): `<iframe>` with `src` pointing at the new PDF
  endpoint.
- Right pane (40%): aggregate score banner, summary, parse-confidence
  pills, per-criterion score breakdown (criterion name, score × weight,
  rationale).
- Loading state while detail is fetched; empty/error fallbacks.
- Tests: opens with right candidate, fetches detail, Esc closes,
  iframe `src` is the expected endpoint, score breakdown rendered.

### Step 6 — Coverage sweep + milestone commit

- `pytest --cov` for backend; ensure ≥65% (should remain ~97%).
- `vitest run --coverage` for frontend; ≥65%.
- Save reports to `docs/coverage/backend_milestone_7/summary.txt` and
  `docs/coverage/frontend_milestone_7/summary.txt`.
- Milestone-complete commit with actual percentages.

## Verification

- Manual: create a new role → lands on Basics tab with Criteria/Resumes
  locked → save → tabs unlock → switch to Criteria → empty hero with
  Extract + Add → click Extract → criteria rows populate → tweak a
  weight (Low/Med/High) → drag a row to reorder → Save → switch to
  Resumes → upload PDFs → see list populate with status pills → wait
  for processing → click a complete row → modal opens with PDF on left
  + LLM output on right → Esc closes.
- Backend coverage ≥65%.
- Frontend coverage ≥65%.

## Out of scope (future milestone)

- Workspace page redesign.
- "JD changed since last extract" detection / banner.
- A view that lists candidates here ranked by score (intentionally lives
  in Workspace).
- Bulk delete / re-process actions.
