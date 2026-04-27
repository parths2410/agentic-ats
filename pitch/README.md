# pitch/ — technical materials for Spine Technologies

A self-contained pitch package focused on the backend agentic architecture
of Agentic ATS, prepared for an integration / acquihire conversation with
the directors of Spine Technologies (an HRMS company).

## What's here

| File | Purpose |
|---|---|
| **`index.html`** | The single-page presentation. Engineering-blog tone, ~12 sections, self-contained (no external CDN, no JS). Open in a browser; share screen during the meeting. |
| **`plan.md`** | How to drive the meeting. Time budget, anticipated questions with sketched answers, what to lead with, what to skip. Read this before the meeting; don't read it *to* them. |
| `deep-dives/01-agentic-loop.md` | Deeper than the HTML allows: the loop's design, the iteration cap, the accumulator's merge rules, what changes for Spine. |
| `deep-dives/02-tools-contract.md` | The four-file split, anatomy of a schema, a worked `schedule_interview` example. |
| `deep-dives/03-prompt-strategy.md` | All four prompts walked through — what every clause is doing and why, plus our iteration practice. |
| `deep-dives/04-resume-pipeline.md` | Stage-by-stage, including failure modes, the OCR-fallback heuristic, the `stale_scores` invariant, cost/latency profile. |
| `deep-dives/05-llm-abstraction.md` | The ABC, what an Azure OpenAI provider looks like, multi-provider deployment patterns. |
| `diagrams/*.mmd` | Mermaid sources for the five diagrams embedded in `index.html`. Editable. Render with `mmdc` or paste into [mermaid.live](https://mermaid.live). |

## How to use this in the meeting

1. Open `index.html` in a browser. Share screen.
2. Drive top-to-bottom or jump via the table of contents at the top.
3. After the meeting, send the directors a zip of the whole `pitch/`
   folder for follow-up reading. The deep-dives are the form factor for
   "I want to read this carefully on a plane".

## How to keep it current

The HTML and the deep-dives quote real code with file paths and line
ranges. The line numbers will drift as the codebase evolves. When that
happens:

- Run a search for the function name (e.g. `handle_message`,
  `UIMutationsAccumulator`) in the relevant file and update the line range
  in the `figcaption` / `## Files` section.
- The code excerpts themselves are short enough to spot-check by eye
  against the source.

If a major refactor changes any of the five subsystems' shape, the deep-
dive for that subsystem may need a substantial rewrite. The HTML's
overview sections are more durable.

## Self-contained?

Yes. `index.html` has no external dependencies — no CDN, no fonts, no JS.
It will render the same on a plane as in the office. SVG diagrams are
embedded inline; code blocks are styled with embedded CSS only.

## Why the engineering-blog tone

That's the visual register asked for, and it suits the audience: a mixed
product+eng room evaluating the codebase for IP acquisition. A polished
deck format would feel like marketing; an RFC would feel inaccessible to
the non-engineers in the room. An engineering blog hits both.
