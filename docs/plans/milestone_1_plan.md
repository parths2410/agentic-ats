# Milestone 1 — Role Management + Criteria Extraction (retroactive plan)

Source of truth for scope: `docs/v1_implementation_plan.md` (Milestone 1).

## Goal

Create a role with a job description, auto-extract scoring criteria from the
JD via the LLM, and let the user edit / reweight / save / delete those
criteria. First LLM integration in the system.

## What was built

### Backend

- `app/services/role_service.py` — `RoleService` with create / get /
  list_with_counts / update / delete. `list_with_counts` joins to candidates
  + criteria so `GET /api/roles` can return the counts the role list view
  needs in a single query.
- `app/api/roles.py` — `POST/GET/PUT/DELETE /api/roles[/{id}]`.
- `app/schemas/role.py` — `RoleCreate`, `RoleUpdate`, `RoleRead`, `RoleSummary`
  (the summary form carries `candidate_count` + `criteria_count`).
- `app/schemas/criterion.py` — `CriterionCreate/Update/Read` and the
  `CriterionProposal` + `CriteriaExtractionResponse` shapes used by the
  extraction endpoint.
- `app/llm/base.py` — `LLMProvider` ABC with the `extract_criteria` method.
- `app/llm/anthropic_provider.py` — `AnthropicProvider` calling Claude with
  the extraction system + user prompts; tolerant JSON extraction (handles
  code fences and prose) so a slightly-misbehaving model response still
  yields usable proposals. Surfaces `LLMResponseError` on parse failure.
- `app/llm/prompts/extract_criteria.py` — prompt that asks for 5–10 concrete,
  scorable criteria with default weights (1.0 must-have, 0.5 nice-to-have)
  and strict JSON output.
- `app/llm/__init__.py` — `get_llm_provider()` FastAPI dependency that builds
  the provider once and surfaces a 503 if `ANTHROPIC_API_KEY` is unset.
- `app/api/criteria.py` — `POST /roles/{id}/criteria/extract` plus the four
  CRUD endpoints (`POST/GET/PUT/DELETE /roles/{id}/criteria[/{cid}]`).
- `app/main.py` — wired in the `roles` and `criteria` routers.
- `requirements.txt` — added `httpx<0.28` to keep the `anthropic==0.39.0`
  client compatible.

### Frontend

- `src/services/api.js` — added `api.roles.{list,get,create,update,delete}`
  and `api.criteria.{list,create,update,delete,extract}`.
- `src/components/RoleList/RoleList.jsx` — full implementation: lists roles
  with `{N} criteria · {N} candidates · created …`, "+ New Role" button,
  Open / Delete actions with a confirm dialog, empty state.
- `src/components/RoleSetup/RoleSetup.jsx` — title + JD form, Create / Save
  Role flow, Extract Criteria button, criterion list, Add Criterion, Save
  Criteria. Uses a draft-id scheme so unsaved criteria don't pollute the DB
  and removed-but-unsaved cards don't fire delete calls.
- `src/components/RoleSetup/CriterionCard.jsx` — name input, description
  textarea, weight slider (0–2 with step 0.05), `auto`/`manual` source badge,
  remove button.
- `src/styles.css` — role list, role setup form, criteria editor, badges.

### Verification artifact

- `frontend/scripts/verify-m1.mjs` — Playwright script that walks the entire
  M1 flow (empty state, create role, extract, edit name/desc/slider, add
  manual, remove, save, refresh-persists, delete with confirm) and writes
  screenshots + a log to `/tmp/m1-screenshots/`. `playwright` was added as
  a frontend devDependency to support this.

## Verification (deliverable in plan)

Walk through end-to-end via the Playwright script above; confirm criteria
make sense for a real JD, edits persist across a hard refresh, and the role
deletion confirm dialog actually deletes from SQLite.

## Files attributed to this milestone

```
backend/app/api/roles.py
backend/app/api/criteria.py
backend/app/services/role_service.py
backend/app/schemas/role.py
backend/app/schemas/criterion.py
backend/app/llm/base.py                       (extract_criteria only)
backend/app/llm/anthropic_provider.py         (extract_criteria only)
backend/app/llm/prompts/extract_criteria.py
backend/app/llm/__init__.py                   (now: get_llm_provider helper)
backend/app/main.py                           (now imports roles, criteria)
backend/requirements.txt                      (now pins httpx<0.28)
frontend/src/services/api.js                  (now: roles + criteria)
frontend/src/styles.css                       (now: role + criteria styles)
frontend/src/components/RoleList/RoleList.jsx           (full impl)
frontend/src/components/RoleSetup/RoleSetup.jsx         (JD + criteria editor)
frontend/src/components/RoleSetup/CriterionCard.jsx
frontend/scripts/verify-m1.mjs
frontend/package.json                          (now: playwright devDep)
frontend/package-lock.json
```
