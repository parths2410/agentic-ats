---
name: Milestone 8 Plan
description: UI Refresh — Workspace page redesign with draggable two-column split, sparse candidate rows, markdown chat, and shared candidate modal
---

# Milestone 8 — UI Refresh: Workspace page

Milestones 6 and 7 redesigned the Roles list and the RoleSetup page. This
milestone redesigns the Workspace (`/roles/:id/workspace`) — the last v1
page that hasn't been refreshed.

## Decisions (locked-in from product discussion)

### Layout

- **Two-column split, draggable.** Candidate list on the left, chat on the
  right. A vertical drag handle between them lets the user resize the
  split.
- **Default 40 / 60** (list / chat) — chat is the dominant pane, since
  it's the primary feature of the workspace.
- **Min / max bounds: 25% / 75%.** Neither column can collapse to zero.
- **Double-click the splitter** to reset to default 40/60.
- **Persist the user's split position** to localStorage so it survives
  refresh.
- **Workspace max-width override: 1400px.** Roles list and RoleSetup stay
  at 720px; this page gets a wider canvas because of the two-column
  layout. CSS scopes the override to a workspace-specific class.

### Page header

- Sticky header at the top, matching the RoleSetup pattern.
- Left: role title (large), then a meta line in muted grey.
  "X / Y scored · N criteria · K highlighted · sorted by F (asc/desc) ·
  Reset". The `· Reset` segment appears only when something is sorted
  or highlighted; clicking it clears both.
- Right: `Re-score all` secondary button, then `Setup →` link (mirror of
  the `Open workspace →` link on RoleSetup).
- Drop the standalone `Edit role / criteria` button (replaced by `Setup
  →`) and the standalone `Reset view` button (replaced by the inline
  Reset link).

### Candidate rows

- **Hairline-divider rows** matching the Roles list and Resumes tab.
- Per row: rank (`#1`), name + filename meta, aggregate score, status
  pill, highlighted-state indicator. Whole row is clickable.
- **Click row → opens the existing `CandidateModal`** (the same
  PDF-on-the-left, LLM-output-on-the-right modal we built in milestone
  7). All per-criterion breakdown / rationale / parsed sections live
  there.
- **Highlighted state:** thin colored left-border accent on the row.
  No background tint, no icon — quiet and scannable.
- **Drop:** mini-score chips (each criterion's score), the inline Expand
  button, the inline delete `×`. Deleting candidates is not available
  from the workspace (only from RoleSetup → Resumes).
- **AI-only sort.** No manual sort dropdown. The chat assistant can
  re-sort via tool call; the meta line shows the current sort label.

### Chat panel

- **Visual refresh** to match the Lever aesthetic:
  - Smaller, quieter role labels (tiny uppercase grey: `YOU` /
    `ASSISTANT`).
  - Flat messages — no borders, no bubbles. Subtle background
    differentiation for assistant vs user.
  - Generous vertical spacing between messages.
  - Bigger input area with the Send button inside the input box (right
    corner) instead of beside it.
- **Markdown rendering for assistant messages.** Use `react-markdown`
  with `remark-gfm`. User messages stay plain text. Supports bold,
  italic, lists, links, inline code, fenced code blocks, tables,
  strikethrough.
- **Clear button** stays in the chat header (easy access), but wrap it
  in a `confirm("Clear chat history? This can't be undone.")` so a
  stray click doesn't nuke history.
- Keep the existing example prompts in the empty state.
- Keep tool-status / "thinking…" indicators inline in the message
  stream (no relocation).

### Stale-scores banner

- Keep, restyle. Subtle yellow background, hairline border, no harsh
  red. Inline `Re-score now` text link.

### Empty state

- When the role has no candidates, show a centered hero: "No candidates
  yet" headline + primary `Upload resumes →` button linking to
  RoleSetup → Resumes tab.

## Steps

### Step 1 — Workspace shell + page header + width override

- Sticky page header: large role title + meta line (with inline Reset)
  + Re-score all + Setup → link.
- Workspace max-width override (1400px) scoped to a workspace class.
- Drop the old `Edit role / criteria` and `Reset view` buttons.
- Tests: header rendering with / without sort+highlight, Reset link
  visibility, Re-score click, Setup → href.

### Step 2 — Sparse candidate rows + modal click + highlighted accent

- New `CandidateRow` component. Hairline divider, no card border.
- Drop the mini-score chips, the Expand button, the inline delete.
- Whole row clickable → opens `CandidateModal` (reused from milestone 7).
- Highlighted state via a left-border accent class.
- Tests: row rendering, modal open on click, highlighted-state class,
  empty state hero, error display.

### Step 3 — Draggable splitter

- New `Splitter` component / behavior. Pointer events on a vertical
  handle update a CSS grid template ratio.
- Persist to `localStorage["workspace.split.fraction"]`.
- Min 25%, max 75%, default 40% (list).
- Double-click resets to default.
- Tests: drag adjusts ratio, bounds clamp, double-click resets,
  localStorage persistence, default fallback.

### Step 4 — Chat panel refresh + markdown + clear confirm

- Install `react-markdown` and `remark-gfm`.
- Render assistant messages via `<ReactMarkdown remarkPlugins=
  {[remarkGfm]}>`. User messages stay as plain text.
- Visual refresh per spec.
- `Clear` button calls `confirm()` before invoking `clear()`.
- Tests: markdown renders bold/list/link, plain user text, empty-state
  examples shown, confirm guard on Clear (cancelled vs accepted).

### Step 5 — Stale-scores banner + empty hero

- Restyle the banner to match the new aesthetic.
- Replace the one-line "No candidates yet" hint with a centered hero
  + `Upload resumes →` CTA linking to `/roles/:id?tab=resumes`.
- Tests: banner appears when stale > 0, click "Re-score now" calls the
  rescore API, empty hero links to the right URL.

### Step 6 — Coverage sweep + milestone commit

- `pytest --cov` for backend (no backend changes; should remain ~97%).
- `vitest run --coverage` for frontend; ≥65%.
- Save reports to `docs/coverage/{backend,frontend}_milestone_8/
  summary.txt`.
- Milestone-complete commit with actual percentages.

## Verification

- Manual end-to-end:
  1. Navigate to `/roles/<id>/workspace`.
  2. See sparse list left, chat right, splitter between.
  3. Drag splitter — both panes resize. Refresh — split persists.
  4. Double-click splitter — resets to 40/60.
  5. Click a candidate row — modal opens (same as Resumes tab).
  6. Ask chat to highlight or sort — see meta line update with `Reset`
     appearing; left-border accent on highlighted rows.
  7. Click `Reset` link — sort + highlights clear, link disappears.
  8. Click `Setup →` — back to RoleSetup.
  9. Try to clear chat — `confirm()` dialog before wiping.
  10. Send an assistant query that returns markdown — verify bold,
      lists, code render correctly.
- Backend coverage ≥65%.
- Frontend coverage ≥65%.

## Out of scope

- Backend changes (none expected for this milestone).
- Aggregate-score discrepancy (filed separately at
  `docs/known_issues.md`).
- Manual sort UI (intentionally AI-only).
- Inline candidate delete (intentionally only available from
  RoleSetup → Resumes).
- Mobile / narrow-viewport layout (the workspace is desktop-first).
