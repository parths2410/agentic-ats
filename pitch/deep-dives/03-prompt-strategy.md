# Deep dive · Prompt strategy

> Four prompts, ~250 lines total, hand-written and versioned in-repo.
> Every line is there for a reason. Most are bug-fixes.

---

## Prompts as code

The four prompts live as Python modules under `backend/app/llm/prompts/`:

```
parse_resume.py       SYSTEM_PROMPT, build_user_prompt(raw_text)
score_candidate.py    SYSTEM_PROMPT, build_user_prompt(jd, criteria, profile)
extract_criteria.py   SYSTEM_PROMPT, build_user_prompt(jd)
chat_system.py        _BEHAVIOR_RULES, build_system_prompt(role, criteria, ...)
```

Treating prompts as code means they:

- Live in version control. Every change is a commit, attributable, reviewable, revertable.
- Get tested. The unit tests for each service include "prompt formatting" cases that ensure the substituted variables land in the right places.
- Are imported, not loaded. `from app.llm.prompts.parse_resume import SYSTEM_PROMPT, build_user_prompt`. No file I/O at runtime.
- Are model-agnostic. None of them references Claude or Anthropic; the same text runs against GPT-4-class models in our spike testing without edits.

The alternative — a `prompts` table in the database, edited from a vendor
console — invites drift. We have seen it cause production incidents at other
shops. We don't do it here.

---

## Five recurring patterns

Every prompt in the system uses some subset of these techniques:

1. **Schema-anchored output.** The prompt declares the exact JSON schema it
   wants back, in-line, and demands "no prose, no code fences". Downstream
   parsing is one `json.loads`. No regex, no fence-stripping, no fallback
   parsers.

2. **Calibration anchors.** When the model is asked to score, every band of
   the scale is given a written description. This is the difference between
   "every candidate is a 7" and a usable distribution.

3. **Anti-confabulation rules.** "If absent, set null. Do not invent." stated
   plainly. We've found these need to be in the *system* prompt, not the user
   prompt — putting them in the user prompt makes the model treat them as part
   of the task description and creatively reinterpret.

4. **Confidence channels.** Where output quality depends on input quality
   (resume parsing), the model rates its own confidence per section. We
   surface this to the user; no bolted-on "is this a good extraction" model.

5. **Behavior rules separated from context.** The chat system prompt has a
   fixed `_BEHAVIOR_RULES` block stitched onto a per-role context block. This
   means we can iterate on rules without rebuilding the context construction.

---

## 1. `extract_criteria` — JD → scorable criteria

### Purpose

Take a raw job description (free-form English) and propose 5–10 *scorable*
hiring criteria. "Scorable" is the operative word: each criterion has to be
something a recruiter could rate from the resume alone.

### Notable design choices

- **Two-tier weighting.** We force `weight ∈ {0.5, 1.0}`. We tried floats
  initially and the model produced 0.7s and 0.85s that were uncalibrated and
  hard to explain to users. The binary choice — "must-have or nice-to-have" —
  is sharper.
- **Cap the count.** "5–10 criteria" prevents a 30-criterion soup that the
  scoring stage couldn't handle reliably.
- **No overlap.** The rule "do not create overlapping criteria — each should
  evaluate a distinct dimension" was added after we found the model
  proposing both "Python proficiency" and "Backend Python experience" for
  the same JD.

### The prompt

```
You are an expert technical recruiter and hiring manager.
Your job is to read a job description and propose a set of concrete, scorable criteria
that a hiring team can use to evaluate candidate resumes against the role.

Output requirements:
- Produce 5-10 criteria. Fewer is fine if the JD is sparse; more is fine if the JD is rich.
- Each criterion must be scorable from a resume — i.e., something you can assess based on
  what a candidate has done, built, studied, or demonstrated.
- Cover both hard requirements (specific skills, years of experience, education,
  certifications) and soft qualities (leadership, communication, ownership, domain
  judgment) when the JD calls for them.
- Each criterion needs a short name and a one-to-two sentence description that explains
  what to look for in a resume to evaluate it.
- Default weights:
    - 1.0 for must-haves and explicit requirements
    - 0.5 for nice-to-haves and implicit/soft qualities
- Do not invent criteria the JD does not support. Stay grounded in the role description.
- Do not create overlapping criteria — each should evaluate a distinct dimension.

Output strictly as JSON matching this schema:
{
  "criteria": [
    {
      "name": "string (short, title-case)",
      "description": "string (1-2 sentences, what to look for)",
      "weight": 0.5 | 1.0
    }
  ]
}

Return only the JSON object — no prose, no markdown fences.
```

---

## 2. `parse_resume` — raw text → structured profile

### Purpose

Convert messy resume text (post-extraction, post-OCR) into a clean, queryable
JSON profile.

### Notable design choices

- **The whole schema is in the prompt.** We tried "describe the schema in
  prose" and "use a JSON Schema reference"; both produced occasionally
  malformed output. Inline-the-schema is verbose but robust.
- **Free-text dates.** `start_date` and `end_date` are strings, not parsed
  dates. Resumes are written in many formats ("Jan 2020", "2020-01",
  "January 2020 – Present"); parsing is a downstream concern.
- **Specific skills only.** "Skills should be specific (e.g., 'PostgreSQL',
  'Kafka', 'React'), not generic ('programming', 'communication')." This one
  rule removed a class of garbage entries from candidate profiles.
- **Per-section confidence.** `confidence_scores` is a sibling of the data,
  not metadata. It rates the *source quality* per section, not the model's
  certainty. A poorly OCR'd scan gets `low` across the board even if the
  model "thinks" it parsed it well.

### Excerpt

```
Rules:
- If you cannot determine a field, set it to null (or [] for list fields).
- Do NOT invent information. If something isn't in the resume, leave it null.
- For dates that are ambiguous, use your best interpretation and lower the confidence
  for that section.
- Skills should be specific (e.g., "PostgreSQL", "Kafka", "React"), not generic
  ("programming", "communication").
- Keep experience descriptions concise — 1 to 3 sentences each.
- confidence_scores reflects how clean and unambiguous the source text was for each
  section.

Return ONLY the JSON object.
```

---

## 3. `score_candidate` — calibrated scoring with rationale

### Purpose

Given a JD, a list of criteria, and a structured candidate profile, produce a
score 1–10 per criterion plus a 1–2 sentence rationale citing specific
evidence from the profile.

This is the most carefully engineered prompt in the system. It is the
difference between "every candidate looks roughly the same" and a usable
ranking.

### Notable design choices

- **Anchor every band.** Without explicit "what does a 7 mean vs a 5" text,
  models cluster everything in the 6–8 range. The anchor descriptions force
  spread.
- **Demand cited evidence.** "Cite specific evidence from the candidate's
  profile (titles, companies, projects, years)." This single rule makes the
  output dramatically more useful — and harder to fake. A score of 8 with no
  named evidence is a hallucination tell.
- **Forbid score-padding.** "If evidence is missing or weak, score it lower
  — do not pad scores." Models naturally hedge upward toward the median;
  this rule pulls them back.
- **Exact name matching.** The model must use the criterion's `name` field
  *verbatim* as `criterion_name`. Without this rule, the model "improves"
  the names ("Python" becomes "Python Programming Skill") and downstream
  joining breaks.
- **Conservative on sparse profiles.** "If the profile is sparse or
  unparseable, score conservatively (1-3) and say so in the rationale."
  Otherwise the model invents experience to score against.

### The scoring scale

```
- 1-2: No evidence. The resume contains nothing supporting this criterion.
- 3-4: Weak evidence. Some adjacent or transferable signal but no direct match.
- 5-6: Meets expectations. Direct evidence of the criterion at a competent level.
- 7-8: Strong. Multiple data points, clear depth or scope.
- 9-10: Exceptional. Standout indicators (rare expertise, scale, recognition).
```

### Why one call per candidate, not one per criterion

We considered fan-out: one LLM call per (candidate, criterion). It would
parallelise better and give finer-grained progress events.

We chose not to:

- **Holistic context.** When the model sees all criteria at once, a strong
  signal in one ("ten years of Python at a fintech") properly informs
  adjacent ones ("backend depth", "domain experience"). With independent
  calls, each criterion is judged in isolation and consistency suffers.
- **Cost.** N criteria × C candidates is up to 80 calls per role. One call
  per candidate is C calls.
- **Rationale coherence.** A single overall_summary written after all
  per-criterion rationales tends to read like a recruiter's summary,
  not a model's collation.

The scoring prompt is therefore "all criteria, one candidate, one call".

---

## 4. `chat_system` — the tool-aware system prompt

### Purpose

This is the prompt that drives the agentic chat loop. It has two halves:

- A **per-role context block** built at runtime: role title, JD, criteria
  (with weights and descriptions), candidate count.
- A **fixed behavior rules block** (`_BEHAVIOR_RULES`) that codifies how the
  model should use its tools.

### Why split

The context block has to be regenerated on every turn — criteria change,
candidates get added, etc. The rules don't. Splitting them lets us iterate
on rules in isolation, without exercising every codepath that builds context.
Each half has its own unit test; they're combined at the bottom of the
builder function.

### The behavior rules

Every line earned its place. Annotations on a few:

- *"Highlights are additive and 'soft' — never claim to remove or hide
  candidates."* — bug fix. The model used to write "I've removed the
  candidates without Python experience" when in fact we don't remove anyone;
  highlighting just narrows the visible set.

- *"For filter chaining ('from those…', 'of these…'), FIRST call get_ui_state
  to read the currently highlighted ids."* — bug fix. The model used to
  ignore the existing context and start a fresh search, breaking the user's
  mental thread.

- *"For statistics, prefer compute_stats over fetching all candidates and
  counting by hand."* — efficiency fix. The model would otherwise call
  `get_candidates(limit=200)` and count in its head. The dedicated tool is
  one round-trip and cheaper.

- *"For deep-dive questions about one candidate, fetch raw resume text — the
  structured profile may miss nuance."* — quality fix. The structured
  profile is a lossy summary; the raw text is the source of truth for
  questions like "did they mention specific cloud platforms".

- *"Reference candidates by name when responding; reference criteria by name
  when explaining scores."* — UX fix. Without this rule the model would say
  "candidate 7 scored 8 on criterion 3", which a recruiter cannot use.

- *"Keep responses tight and actionable — one short paragraph or a brief
  bulleted list is usually enough."* — UX fix. The default model output is
  too long for a chat panel.

### The construction

The builder is a regular Python function:

```python
def build_system_prompt(role_title, job_description, criteria, candidate_count):
    crit_lines = []
    for c in criteria:
        name = c.get("name") or "(unnamed)"
        weight = c.get("weight", 1.0)
        desc = (c.get("description") or "").strip()
        line = f"- {name} (weight {weight})"
        if desc:
            line += f": {desc}"
        crit_lines.append(line)
    criteria_block = "\n".join(crit_lines) if crit_lines else "(no criteria defined yet)"

    return f"""You are an HR analysis assistant for the role: {role_title}.

Job Description:
{job_description.strip() or "(no job description provided)"}

Scoring Criteria:
{criteria_block}

Current candidate pool: {candidate_count} applicants.

You have tools to query candidate data, compute statistics, and (in due
course) control the UI (highlights, sorting). Use them to answer the HR
professional's questions accurately.

{_BEHAVIOR_RULES}
"""
```

The empty-state defaults ("(no criteria defined yet)", "(no job description
provided)") are deliberate. The chat is usable before criteria are extracted —
the model just stays neutral about scoring until criteria exist.

---

## Provider portability

None of these prompts mention Claude, Anthropic, or any vendor specifics. We
have run all four against:

- Claude (production)
- GPT-4-class (spike testing)

…with no edits required for the prompt text. The differences come out in the
*provider* code (how to format tool definitions, how to translate `tool_use`
blocks, how to map error types) — not in the prompts.

This is a deliberate constraint we apply when authoring prompts: if a line
only makes sense for one model, rewrite it. The prompts have to remain a
portable asset.

---

## Iteration practice

How we change a prompt:

1. **Reproduce the failure.** A specific user query that produces a wrong
   answer. We file these in a small fixture file.
2. **Add a unit test.** Mock the LLM to return the wrong answer, assert the
   downstream code does the right thing. (Sometimes the bug is downstream;
   sometimes the prompt needs to change.)
3. **Edit the prompt.** Usually one or two lines.
4. **Run the manual eval.** A small, hand-curated set of
   (input → expected behaviour) pairs we run through the live LLM. Adds
   ~30 seconds per change.
5. **Commit with a reason.** Commit message says what failure mode this
   change addresses. Future readers can find why a line exists by `git blame`.

This is not science, but it's repeatable. Most prompt edits in the project
are one-liners that fix a specific class of failure.

---

## Files

- `backend/app/llm/prompts/extract_criteria.py`
- `backend/app/llm/prompts/parse_resume.py`
- `backend/app/llm/prompts/score_candidate.py`
- `backend/app/llm/prompts/chat_system.py`
- `backend/tests/test_*_service.py` — each prompt has an integration test that mocks the LLM and asserts service-level behaviour.
