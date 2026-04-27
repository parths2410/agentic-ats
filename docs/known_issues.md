# Known issues

Bugs that have been observed but not yet fixed. Prioritize against current
milestone work; not every issue blocks shipping.

## Active

### Aggregate score doesn't match per-criterion scores

**Observed:** 2026-04-26, manual walkthrough at the end of milestone 7.

**Symptom:** Alice Chen on the M2 role shows an aggregate of **7.3** while
her per-criterion scores are 9.0, 8.0, 9.0, 9.0, … (all in the 8–9 range
out of 10). A plain weighted average can't land at 7.3 from those inputs
unless either:

- the weights stored in the DB are not what the UI is rendering, or
- the aggregate formula in `resume_service.py` / `score_candidate.py` is
  not a simple weighted mean (e.g. it normalizes against a max possible
  score, applies a penalty, or sums missing criteria as zeros).

**Suspected cause:** unverified — could be a backend math bug, or the
formula could be intentional and the UI is just misleading. Either way the
displayed numbers don't reconcile to a hiring manager.

**Where to look:**
- `backend/app/services/resume_service.py` — search for where
  `aggregate_score` is computed and persisted.
- `backend/app/llm/prompts/score_candidate.py` — confirms scoring scale is
  1–10 per criterion.
- `backend/tests/test_resume_service.py` — check if there's a test pinning
  the aggregate formula.

**Severity:** medium. Doesn't break the app but mis-informs the user about
candidate ranking, which is the product's whole point.

**Repro:** open `/roles/<role>/?tab=resumes`, click any complete candidate
row → modal → compare `aggregate banner` vs `score breakdown` numbers.
