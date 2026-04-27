# Deep dive · The tool contract

> The single surface the LLM uses to read and change application state.
> Why we split it four ways, what it costs to add a tool, and how it
> generalises to HRMS-specific actions.

---

## What "tool" means here

A tool is a JSON-schema-described function the LLM can call. The LLM sees the
tool's `name`, `description`, and `input_schema`. When the model decides to call
it, the LLM emits a `tool_use` block with arguments matching the schema; we
execute the corresponding Python function and return the result back to the
model.

That's it. There is no magic. The interesting part is *where the boundaries
are drawn*.

---

## The four-file split

```
backend/app/tools/
├── definitions.py    # JSON schemas exposed to the LLM
├── data_tools.py     # read-only executors
├── action_tools.py   # mutation executors
└── registry.py       # name → executor dispatch
```

This split is not theoretical. Each file has one reason to change.

### `definitions.py` — the LLM-facing surface

Pure JSON schema dicts, plus a single derived constant:

```python
ACTION_TOOL_NAMES: set[str] = {
    "set_highlights",
    "remove_highlights",
    "clear_highlights",
    "set_sort",
    "reset_ui",
}
```

The `ACTION_TOOL_NAMES` set is what the chat loop consults to decide whether to
look for a `mutation` field in a tool's result. This means the loop is
*decoupled from the tool registry's runtime state* — it makes its decision
purely from a static set the tool author updates when they add an action tool.

### `data_tools.py` — read-only executors

Pure functions of `(db, role_id, args)`. No commits. No side effects. They
return data dicts that go straight back to the model.

This restriction makes them trivially safe to reorder, retry, or call in
parallel. It also makes them trivially unit-testable: `test_data_tools.py` is
the largest test file in the project and runs in 0.4 seconds against an
in-memory SQLite.

### `action_tools.py` — mutation executors

Same signature, different return shape:

```python
{
    "ui_state": <fresh state for the LLM to keep reasoning with>,
    "mutation": {"type": "<kind>", ... },
}
```

The two-channel return is the small piece of design that makes the whole
system work:

- The model sees `ui_state` in the next iteration's history. So if it just did
  `set_highlights`, the next `get_ui_state` call returns the right thing
  without us having to mock or remember.
- The accumulator in the chat loop sees `mutation`. It folds across the turn
  and emits one final UI delta. The model never sees `mutation`; the UI never
  sees `ui_state` (it has its own).

### `registry.py` — the dispatcher

A `dict[str, Executor]` plus an `execute(name, args, db, role_id)` method.
That's the entire file:

- 30 lines for the default executor map.
- 10 lines for the dispatch method.
- 10 lines for `definitions()` and the unknown-tool error.

It is the kind of class people sometimes argue should be just functions. It's
a class because we want to be able to inject a different executor map in tests
(we do, frequently — we run the loop tests with mocked tools).

---

## Today's twelve tools

### Read-only (7)

| Tool | What it does | Notable args |
|---|---|---|
| `get_candidates` | Lists candidates with rank, score, basic profile fields. | `limit`, `offset` |
| `get_candidate_detail` | Full structured profile for one candidate. | `candidate_id` |
| `get_candidate_raw_text` | Original resume text — for nuance the structured profile loses. | `candidate_id` |
| `get_candidate_scores` | Per-criterion scores + rationale. | `candidate_id` |
| `search_candidates` | Substring search over a chosen profile field. | `field`, `query`, `limit` |
| `compute_stats` | Aggregate stats over the candidate pool. | `field` |
| `get_ui_state` | Current highlights + sort. **The chaining tool** — the LLM reads this before "from those…" filters. | — |

### Action (5)

| Tool | What it does |
|---|---|
| `set_highlights` | Replace the highlight set with exactly these IDs. |
| `remove_highlights` | Remove specific IDs from the current highlight set. |
| `clear_highlights` | Empty the highlight set. |
| `set_sort` | Re-sort by aggregate or any criterion name. |
| `reset_ui` | Drop highlights + sort to defaults. |

---

## Anatomy of a schema

The schema is what the LLM *sees*. Everything we want it to know — including
anti-patterns we want it to avoid — lives in `description`.

`set_highlights` is the canonical example because we've iterated on it the
most:

```python
SET_HIGHLIGHTS = {
    "name": "set_highlights",
    "description": (
        "Replace the highlighted-candidates set with exactly these IDs. This is "
        "the single source of truth for what is highlighted right now — calling "
        "it does NOT add to the existing set, it overwrites it. Use this for any "
        "filter/highlight/shortlist request. For filter chaining ('from those…'), "
        "first call get_ui_state to read the current highlight set, then intersect "
        "with your new search results, then call set_highlights with that "
        "intersection. To clear all highlights, call clear_highlights instead. "
        "Never claim to remove or hide candidates — only highlight matches. "
        "IMPORTANT: pass the candidate's `id` field from get_candidates (a UUID "
        "string like 'd91eebc3-de25-…'), NOT the `rank` integer."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "candidate_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "The complete list of candidate UUIDs ...",
            },
        },
        "required": ["candidate_ids"],
    },
}
```

Every clause earned its place:

- "Replace the highlighted-candidates set" — was missing. The model was
  treating `set_highlights` as additive (it's named like an additive verb). Fix
  was the description, not a rename, because rename would mean re-prompting.
- "Use this for any filter/highlight/shortlist request" — primes the model to
  reach for this tool when the user's intent is *any* form of narrowing.
- The filter-chaining recipe — was the bug fix for "of these, only the
  ones with…". The model used to issue a fresh search and replace the
  highlights, losing the prior context. The recipe forces it to read state
  before deciding.
- "Never claim to remove or hide candidates — only highlight matches" — the
  model used to write "I've removed the candidates without Python experience"
  in its response. We don't actually remove anyone (everyone stays in the
  list, just unhighlighted). Adding this line forced the prose to match the
  semantics.
- "pass the candidate's `id` … NOT the `rank` integer" — the model used to
  confuse the columns. One line of description, problem fixed.

The schema is a contract. Most prompt-engineering effort in this project has
gone into the descriptions, not the system prompt.

---

## The executor surface

Every executor has the same signature:

```python
def name(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    ...
```

That uniformity matters because the registry doesn't have to know anything
about the tool. It dispatches by name and calls the executor with three
parameters. New tool? Same shape.

### A read-only executor

`search_candidates` is a substring search with excerpt extraction:

```python
def search_candidates(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    field = str(args.get("field", "")).lower()
    query = str(args.get("query", "")).strip()
    limit = int(args.get("limit", 50))
    if not field or not query:
        return {"error": "field and query are required", "matches": []}

    needle = query.lower()
    matches = []
    for c in _all_candidates(db, role_id):
        joined = " ".join(v for v in _profile_text(c, field) if v)
        if not joined:
            continue
        if needle in joined.lower():
            matches.append({
                "candidate_id": c.id,
                "name": c.name,
                "rank": c.rank,
                "aggregate_score": c.aggregate_score,
                "excerpt": _excerpt(joined, query),
            })
            if len(matches) >= limit:
                break
    return {"field": field, "query": query, "match_count": len(matches), "matches": matches}
```

The `_excerpt` helper returns ~80 characters around the match — enough for
the LLM to verify the hit is relevant before relaying it to the user.

### A mutation executor

`set_highlights` is short:

```python
def set_highlights(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    raw = args.get("candidate_ids") or []
    candidate_ids = [str(c) for c in raw if c]
    svc = _service(db)
    row = svc.replace_highlights(role_id, candidate_ids)
    state = svc.to_dict(row)
    return {
        "ui_state": state,
        "mutation": {"type": "set_highlights", "ids": candidate_ids},
    }
```

The actual DB write is delegated to `UIStateService.replace_highlights()` —
the executor is a thin LLM-facing adapter. That keeps "what the tool exposes"
separate from "how the storage works".

---

## Adding a tool: a worked example

Imagine we want to add `schedule_interview` for Spine. Here's what changes,
and what doesn't.

### What changes

**1. `definitions.py`** — add the schema:

```python
SCHEDULE_INTERVIEW = {
    "name": "schedule_interview",
    "description": (
        "Schedule an interview between a candidate and a hiring manager. "
        "Use this when the user explicitly asks to schedule, book, or "
        "set up an interview. Confirm the candidate by ID and the time "
        "in the user's timezone before calling."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "candidate_id": {"type": "string"},
            "interviewer_id": {"type": "string"},
            "start_time_iso": {"type": "string", "description": "ISO-8601, e.g. 2025-04-12T14:00:00Z"},
            "duration_minutes": {"type": "integer", "minimum": 15, "maximum": 240},
            "round": {"type": "string", "enum": ["screen", "technical", "onsite", "final"]},
        },
        "required": ["candidate_id", "interviewer_id", "start_time_iso", "duration_minutes"],
    },
}

ACTION_TOOL_NAMES.add("schedule_interview")
```

**2. `action_tools.py`** — add the executor:

```python
def schedule_interview(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    candidate_id  = str(args["candidate_id"])
    interviewer   = str(args["interviewer_id"])
    start_iso     = str(args["start_time_iso"])
    duration_min  = int(args["duration_minutes"])
    round_kind    = str(args.get("round", "screen"))

    svc = _spine_calendar_service(db)
    interview = svc.book(
        candidate_id=candidate_id,
        interviewer_id=interviewer,
        start=parse_iso(start_iso),
        duration=timedelta(minutes=duration_min),
        round=round_kind,
    )
    return {
        "interview": svc.to_dict(interview),
        "mutation": {
            "type": "interview_scheduled",
            "candidate_id": candidate_id,
            "start_iso": start_iso,
        },
    }
```

**3. `registry.py`** — add the entry:

```python
_DEFAULT_EXECUTORS["schedule_interview"] = action_tools.schedule_interview
```

**4. `chat_system.py`** — add a behavior rule (optional but nice):

```python
- For interview-scheduling requests, call schedule_interview. Confirm
  the candidate by name and the proposed time before calling.
```

### What doesn't change

- The chat loop. Not one line.
- The provider. Not one line.
- The accumulator. We may extend it for richer mutation types (e.g.
  `interview_scheduled` would just be passed through as a one-shot
  notification), but the existing payloads are unchanged.
- Any existing tool. They are independent.

This is the property that makes the engine a *platform* for HR features rather
than a closed product. Every HR-specific behaviour Spine wants is one
schema + one function + one registry entry away.

---

## Why not let the LLM call REST endpoints?

A reasonable alternative architecture would be: skip the tool layer, just give
the model an OpenAPI spec and let it call the API.

We considered it. We chose not to for three reasons:

1. **Permission boundary.** The tool layer is the only thing the LLM can do.
   A REST API includes endpoints the user uses — `POST /candidates/upload`,
   `DELETE /roles/...` — that we don't want a chat assistant initiating.
   Having a smaller, deliberately-curated tool surface is a security property,
   not a stylistic choice.
2. **Calibrated descriptions.** REST endpoints are documented for human
   developers, not LLMs. The careful, iterated descriptions in `definitions.py`
   would have to live alongside the OpenAPI spec, doubling the maintenance
   burden.
3. **Mutation accumulation.** REST returns 200 OK and a body. There's no
   natural place to put a "what UI delta does this imply" payload. The tool
   layer's `{ui_state, mutation}` return shape is purpose-built for the
   accumulator.

The tool layer is more code than "use the OpenAPI", but the code is small
(definitions + dispatch + 12 functions averaging 20 lines) and the boundaries
are clean.

---

## Files

- `backend/app/tools/definitions.py` — every tool schema, plus `ACTION_TOOL_NAMES`.
- `backend/app/tools/data_tools.py` — 7 read-only executors + private helpers.
- `backend/app/tools/action_tools.py` — 5 mutation executors.
- `backend/app/tools/registry.py` — dispatch.
- `backend/app/services/ui_state_service.py` — DB persistence for highlights/sort.
- `backend/tests/test_data_tools.py`, `test_action_tools.py`, `test_registry.py` — full coverage.
