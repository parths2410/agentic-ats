# CLAUDE.md — docs

Reference material, not code. Read before designing changes; don't auto-update without being asked.

## What lives here

- **`v1_requirements.md`** — product requirements. The *why*.
- **`v1_architecture.md`** — canonical design doc. The *what*. If code disagrees with this doc, code wins; flag the drift but don't silently rewrite the doc.
- **`v1_implementation_plan.md`** — original milestone breakdown.
- **`plans/milestone_*_plan.md`** — per-milestone plans (0–8). Historical record of what each milestone scoped and why.
- **`coverage/`** — per-milestone coverage snapshots (`summary.txt` files; HTML/JS/CSS are gitignored). Used to track regressions between milestones, not for live status.
- **`COMPLETION_REPORT.md`** — milestone-by-milestone build log. Older numbers in here may be stale relative to current `git log`; treat it as a historical artifact.
- **`known_issues.md`** — observed bugs that haven't been fixed. **Always check this before "fixing" something that looks broken** — the active aggregate-score discrepancy, for example, may be intentional or may have a specific repro path documented here.

## When to update

- **`known_issues.md`** — add an entry when you observe a bug you aren't fixing this turn. Remove or mark resolved when fixed.
- **`v1_architecture.md`** — only when the user explicitly asks, or when a deliberate architectural change has landed. The doc is meant to be load-bearing, so unauthorized edits create ambiguity.
- **`plans/`** and **`COMPLETION_REPORT.md`** — historical; don't backfill or rewrite.
- **`coverage/`** — only updated by the milestone process. Don't hand-edit.
