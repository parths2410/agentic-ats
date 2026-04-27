# Deep dive · The resume → score pipeline

> Four stages, two LLM calls per candidate, one hard invariant
> (`stale_scores`) that guarantees the rank you see is never from a
> previous criteria set.

---

## The pipeline at a glance

```
PDF bytes
   │
   ▼
[1] Text extraction         pdfplumber → OCR fallback
   │
   ▼
[2] LLM structuring         parse_resume prompt → structured_profile JSON
   │
   ▼
[3] LLM scoring             score_candidate prompt → per-criterion scores
   │
   ▼
[4] Aggregate + rank        weighted sum, sort, persist rank, clear stale
```

Each stage is independent. A failure at [2] leaves the candidate in
`status="error"` with the raw PDF and extracted text intact, ready to retry.
A failure at [3] keeps the structured profile and just marks scores stale.

---

## Stage 1 — text extraction

PDFs in the wild are messy. We see three categories:

| category | % of uploads (rough) | extraction path |
|---|---|---|
| text-native | ~70% | pdfplumber gets perfect text |
| scans / photos | ~20% | pdfplumber returns < 80 chars; OCR runs |
| mixed | ~10% | pdfplumber gets some pages, OCR fills gaps |

The strategy: **try pdfplumber first, fall back to OCR only if the result is
below threshold, and only switch if OCR did better.**

```python
def extract_text(pdf_bytes: bytes) -> str:
    text = _extract_with_pdfplumber(pdf_bytes)
    if len(text.strip()) >= _MIN_TEXT_THRESHOLD:
        return text

    ocr_text = _extract_with_ocr(pdf_bytes)
    if len(ocr_text.strip()) > len(text.strip()):
        return ocr_text
    return text
```

`_MIN_TEXT_THRESHOLD = 80` is empirical. Below 80 characters, the "text" is
typically page numbers, headers, and form metadata — useless for parsing. The
length comparison on the fallback path means a partially-extractable PDF
isn't downgraded to OCR's noisier output unnecessarily.

### pdfplumber details

```python
def _extract_with_pdfplumber(pdf_bytes: bytes) -> str:
    parts = []
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                if page_text.strip():
                    parts.append(page_text)
    except Exception as e:
        logger.warning("pdfplumber extraction failed: %s", e)
    return "\n\n".join(parts).strip()
```

Notes:

- We swallow exceptions and return what we got, because some PDFs partially
  succeed and partially fail. The OCR fallback handles the difference.
- Pages are joined with `\n\n` so the LLM can see the breaks. Resumes often
  have section headers right after page breaks.
- Empty pages are skipped — the model does better with a tight blob than
  one with 4 pages of whitespace between actual content.

### OCR details

```python
def _extract_with_ocr(pdf_bytes: bytes) -> str:
    try:
        import pytesseract
    except ImportError:
        return ""    # tesseract not installed; degrade gracefully
    parts = []
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                try:
                    img = page.to_image(resolution=200).original
                    page_text = pytesseract.image_to_string(img) or ""
                    if page_text.strip():
                        parts.append(page_text)
                except Exception as e:
                    logger.warning("OCR failed for a page: %s", e)
    except Exception as e:
        logger.warning("OCR fallback could not open PDF: %s", e)
    return "\n\n".join(parts).strip()
```

Notes:

- The import is local and lazy. If pytesseract isn't installed (e.g.
  development without OCR libs), the function returns empty rather than
  crashing. Operationally this means "deploy with tesseract installed".
- 200 DPI was the sweet spot in our calibration: 150 lost letters on small
  fonts, 300 doubled processing time with no accuracy gain.
- Per-page exceptions are caught — one corrupted page in a 5-page resume
  doesn't lose the whole document.

---

## Stage 2 — LLM structuring

This stage calls `LLMProvider.parse_resume(raw_text)`, which uses the
[`parse_resume` prompt](./03-prompt-strategy.md#2-parse_resume--raw-text--structured-profile)
to produce a JSON profile.

The output schema lives in the prompt verbatim. The result is stored on the
candidate row as JSON columns:

| column | shape |
|---|---|
| `structured_profile` | `{name, contact_info, summary, experiences[], education[], skills[], certifications[]}` |
| `parse_confidence` | `{name, contact_info, experiences, education, skills}` each `high|medium|low` |

### Failure modes and recovery

| failure | what we do |
|---|---|
| LLM returns invalid JSON | Catch, retry once with explicit "your last response wasn't valid JSON" reminder. Most cases recover. |
| LLM returns valid JSON but missing required fields | Treat as malformed; mark `status="error"` with the validation error string. User sees it in the UI and can re-upload or re-process. |
| LLM call times out / 5xx | The provider's `_with_retry` wrapper retries with exponential backoff. After 3 attempts, the candidate is marked errored. |
| Profile is sparse (low confidence everywhere) | We surface low confidence to the UI; the score stage handles it via the prompt's "score conservatively (1-3)" rule. |

The recovery pattern is the same throughout: **errors are first-class state**.
Candidates have `status` and `error_message` columns, and the UI is built to
show errored candidates so users can decide what to do. Nothing fails silently.

---

## Stage 3 — LLM scoring

This stage calls `LLMProvider.score_candidate(profile, jd, criteria)` which
uses the
[`score_candidate` prompt](./03-prompt-strategy.md#3-score_candidate--calibrated-scoring-with-rationale).

### One call per candidate

The model sees the candidate's full structured profile, the JD, and *all*
criteria at once. It returns:

```json
{
  "scores": [
    {"criterion_name": "Python proficiency", "score": 8, "rationale": "..."},
    {"criterion_name": "AWS depth",          "score": 5, "rationale": "..."},
    ...
  ],
  "overall_summary": "Strong backend engineer with deep Python and..."
}
```

Each entry maps to a `CriterionScore` row keyed by `(candidate_id, criterion_id)`.

### Why criterion_name (string), not criterion_id (UUID)

The LLM never sees the internal UUIDs. We pass it the criteria with `name`
and `description`; we get back `criterion_name`; we resolve the name to its
ID server-side. This:

- Makes the prompt portable across environments (dev/staging/prod have
  different UUIDs but the same criteria names).
- Makes the rationales human-readable by the user without translation.
- Prevents the model from writing UUIDs into rationales (we tried passing
  IDs early on and the model would copy them into prose).

The matching is a strict equality check after a `lower().strip()` normalise.
If the model returns a name that doesn't match any criterion, we drop the
entry and log a warning. (This rarely happens because the prompt explicitly
demands exact match, but the loop is defensive about it.)

---

## Stage 4 — aggregate, rank, and `stale_scores`

### Aggregate score

For each candidate:

```
aggregate_score = sum(score_i × weight_i) / sum(weight_i)
```

…over criteria with non-null scores. The `weight_i` comes from the criterion;
the `score_i` from the candidate's `CriterionScore` row.

This is a simple weighted mean. We've considered fancier scoring (geometric
mean, percentile-rank within pool), and may revisit. For v1 the weighted
mean is interpretable for the user, which matters more than incremental
calibration improvements.

### Rank

After all candidates in a batch finish scoring, ranks are recomputed in one
sweep:

```python
def _recompute_ranks(db: Session, role_id: str) -> None:
    candidates = db.scalars(
        select(Candidate)
        .where(Candidate.role_id == role_id, Candidate.status == "complete")
        .order_by(Candidate.aggregate_score.desc().nulls_last())
    ).all()
    for i, c in enumerate(candidates, start=1):
        c.rank = i
    db.commit()
```

Errored candidates keep `rank = NULL` and sort to the bottom in the UI. No
silent demotion.

### The `stale_scores` invariant

This is the contract the pipeline enforces:

> The aggregate score and rank you see for a candidate always reflects the
> *current* set of criteria — never a previous one.

Implementation:

```
stale_scores: bool = false (default)

  candidate uploaded         status=pending,   stale_scores=false
  scoring complete           status=complete,  stale_scores=false
  user adds/edits criterion  ─► every candidate.stale_scores = true
                                + re-score job triggered
  re-score complete          stale_scores = false (in _persist_scores)
```

The flag is **set true in exactly one place** (the criteria-edit endpoint)
and **cleared in exactly one place** (`_persist_scores` after a successful
re-score). This makes it auditable.

The UI uses `stale_scores` to render a "rescoring…" badge during the window
between criteria-edit and re-score-complete, so users aren't surprised by
shifting numbers.

---

## Concurrency and progress

A batch upload of N resumes processes them concurrently. The worker pool is
bounded (a `Semaphore` limits in-flight LLM calls to a configurable
parallelism — typically 4–8 to stay under provider rate limits and to keep
SQLAlchemy session writes serialisable on SQLite).

### The progress channel

Per-candidate, per-stage progress flows over a dedicated WebSocket
endpoint (`/ws/roles/{id}/progress`). The pipeline publishes via an
in-process pub/sub (`app/pipeline/progress.py`); the WebSocket subscribes
and forwards to clients. Reconnecting clients aren't replayed events
they missed — they read current state from the database via REST and
subscribe forward — but the database is the source of truth, so nothing
is lost.

Frame examples:

```json
{ "type": "batch_started", "total": 12 }

{ "type": "progress",
  "candidate_id": "...",
  "stage": "parsing",
  "status": "in_progress",
  "index": 1, "total": 12 }

{ "type": "progress",
  "candidate_id": "...",
  "stage": "parsing",
  "status": "complete",
  "candidate_name": "Asha Rao",
  "index": 1, "total": 12 }

{ "type": "progress",
  "candidate_id": "...",
  "stage": "scoring",
  "status": "complete",
  "aggregate_score": 7.4,
  "index": 1, "total": 12 }

{ "type": "batch_complete" }
```

This is the channel the reference UI uses to render a "12 of 50 parsed, 8 of
50 scored" progress bar with per-candidate detail.

---

## Cost and latency profile

A typical 50-resume upload, on Anthropic Claude, with criteria already
defined:

| stage | per-resume | 50 resumes (parallelism = 6) |
|---|---|---|
| Text extraction (pdfplumber, no OCR) | ~50 ms | ~1 s |
| Text extraction (with OCR fallback) | 2–5 s | 10–25 s |
| LLM structuring | 2–4 s | ~25 s wall time |
| LLM scoring | 3–6 s | ~50 s wall time |
| Aggregate + rank | <100 ms | <1 s |

So a 50-resume batch typically completes in 1–2 minutes. Most of the wall
time is LLM round-trips; CPU-bound work is negligible.

### Cost (illustrative — depends on JD length and criteria count)

- Parsing: ~1.5K input + ~600 output tokens per resume.
- Scoring: ~2K input + ~800 output tokens per resume.
- Total: ~5K tokens per resume, on Claude Sonnet → ~$0.02–0.04 per resume
  at current pricing.

For Spine: a per-tenant token-budget meter is in the
[roadmap](../index.html#roadmap) (weeks 5–7).

---

## What changes for Spine

- **Stage 1 (extraction)** — unchanged.
- **Stage 2 (structuring)** — unchanged. The prompt is portable across
  providers.
- **Stage 3 (scoring)** — unchanged. Same prompt, same LLM call pattern.
- **Stage 4 (rank)** — unchanged.
- **Per-tenant cost accounting** — add token-counting to the provider's
  `parse_resume` and `score_candidate` methods. ~30 lines.
- **Concurrency tuning** — Postgres can handle higher parallelism than
  SQLite. The `Semaphore` limit becomes a config knob.
- **Reprocess hook** — Spine may want a "re-extract all candidates with the
  newer prompt" admin action. The pipeline supports it (every stage is
  resumable from its predecessor's output) — needs a small admin endpoint.

---

## Files

- `backend/app/services/resume_service.py` — orchestrates the four stages, owns the `Semaphore`, owns rank recomputation.
- `backend/app/pipeline/text_extractor.py` — stage 1.
- `backend/app/pipeline/progress.py` — in-process pub/sub.
- `backend/app/llm/prompts/parse_resume.py` — stage 2 prompt.
- `backend/app/llm/prompts/score_candidate.py` — stage 3 prompt.
- `backend/app/api/websocket.py` — `/ws/.../progress` endpoint.
- `backend/tests/test_resume_service.py` — covers happy path, parse-error path, score-error path, criteria-change → re-score path, and the `stale_scores` invariant.
