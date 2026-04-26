---
name: Milestone 6 Plan
description: UI Refresh — Lever-inspired visual & navigation cleanup, page-by-page
---

# Milestone 6 — UI Refresh

The current UI is information-overloaded and visually rough. We're doing a
Lever-inspired refresh (reference: https://jobs.lever.co/dexterity) — airy,
sparse, hairline dividers instead of cards, large readable type, minimal
chrome — page by page.

**Scope of this sub-plan: the Roles list page only.** Sub-plans for
RoleSetup and Workspace will follow once their designs are agreed (the
roles list is the one we've nailed down so far).

## Decisions (locked-in)

- Direction: Lever careers page aesthetic — generous whitespace, hairline
  dividers (not cards), large readable type.
- Top app `<nav>` removed; the page-level header carries the chrome.
- `HealthBadge` moved into a small page footer.
- Per-row info kept as-is (title, criteria count, candidate count, created
  date) — the user likes the data; only the visual style changes.
- Row affordance: whole row is the click target → `/roles/:id/workspace`.
  Two right-aligned inline-SVG icon buttons — pencil (edit → setup) and
  trash (delete) — both visible always (not hover-only).
- New Role button: top-right of the sticky page header, primary-styled.
- Empty state: centered hero, "No roles yet" + primary CTA `+ Create your
  first role`. Simple, not illustrated.
- Navigation duplicate (`+ New Role` link in the old top nav) dropped.

## Steps

### Step 1 — Layout shell

Replace the top NavLink bar with a minimal shell: no top nav, page content
fills, a small page footer carries the `HealthBadge`.

- Extract `HealthBadge` from `App.jsx` to its own component file.
- Remove the `<nav>` from `App.jsx`.
- Add a `<footer>` to `App.jsx` rendering `HealthBadge` right-aligned, muted.
- styles.css: remove `nav` rules, add `footer` + `.app-footer` rules.
- Tests:
  - `HealthBadge` renders backend status (happy path + error path).
  - `App.jsx` no longer renders a top nav; renders a footer with the badge.

### Step 2 — Roles list page redesign

Implement the new `RoleList` per the locked-in spec.

- Sticky page header with `Roles` title + `+ New role` primary button.
- Hairline-divider row layout, large title (~20px weighty), muted meta line.
- Right-aligned edit (pencil) and delete (trash) inline-SVG icon buttons;
  click handlers `stopPropagation` so they don't trigger the row click.
- Whole-row click → `/roles/:id/workspace`.
- Empty-state hero: centered, "No roles yet" headline + primary CTA
  `+ Create your first role`.
- Small reusable `Icon` component (or inline SVGs scoped to RoleList — pick
  whichever stays simpler given there are only two icons here).
- styles.css: drop old `.role-card`/`.role-list` rules, add new selectors
  for the redesigned list (sticky header, row, icons, empty hero).
- Tests (RoleList):
  - Sticky header renders title + "+ New role" button; button navigates to
    `/roles/new`.
  - Whole-row click navigates to `/roles/:id/workspace`.
  - Edit icon click navigates to `/roles/:id` and does NOT trigger the row
    click (propagation stopped).
  - Delete icon click confirms then calls `api.roles.delete` and removes
    the row; cancelling `confirm` does nothing.
  - Empty state renders the hero with the create-first-role CTA.
  - Loading + error states still render.

### Step 3 — Coverage sweep + milestone commit

- Full backend `pytest --cov` (no backend changes expected; should remain
  ~97%).
- Full frontend `vitest run --coverage`; if either layer dips below 65%,
  add tests for the lines flagged uncovered until it passes.
- Save reports to `docs/coverage/backend_milestone_6/` and
  `docs/coverage/frontend_milestone_6/`.
- Milestone-complete commit with actual percentages.

## Verification

- Manual: load `/`, see sticky header, click row → workspace, click pencil
  icon → setup, click trash → confirm → row removed; delete all roles →
  centered empty hero state.
- Backend coverage ≥65%.
- Frontend coverage ≥65%.

## Out of scope (future sub-plans under Milestone 6)

- RoleSetup page redesign.
- Workspace page redesign.
- Any backend changes — this milestone is purely frontend.
