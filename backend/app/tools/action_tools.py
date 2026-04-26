"""Executors for the chat action tools.

Each function returns a dict of two keys:

- `ui_state`: the current UI state after the mutation, so the LLM can keep
  working with up-to-date highlight/sort info inside the same loop.
- `mutation`: a small structured description of the change for the
  ChatService UIMutations accumulator (and ultimately for the frontend).

The frontend reads `mutation` to apply visual changes; `ui_state` is what
get_ui_state would return next time.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.services.ui_state_service import UIStateService


# Allowed sort fields that aren't criterion names. Anything not in this set is
# treated as a criterion name and surfaced to the frontend verbatim — the
# frontend already knows how to sort by criterion.
SORT_LITERALS: set[str] = {
    "aggregate", "aggregate_score", "rank", "name", "score",
}


def _service(db: Session) -> UIStateService:
    return UIStateService(db)


def set_highlights(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    raw = args.get("candidate_ids") or []
    candidate_ids = [str(c) for c in raw if c]
    svc = _service(db)
    row = svc.add_highlights(role_id, candidate_ids)
    state = svc.to_dict(row)
    return {
        "ui_state": state,
        "mutation": {"type": "set_highlights", "add": candidate_ids, "remove": []},
    }


def remove_highlights(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    raw = args.get("candidate_ids") or []
    candidate_ids = [str(c) for c in raw if c]
    svc = _service(db)
    row = svc.remove_highlights(role_id, candidate_ids)
    return {
        "ui_state": svc.to_dict(row),
        "mutation": {"type": "set_highlights", "add": [], "remove": candidate_ids},
    }


def clear_highlights(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    svc = _service(db)
    row = svc.clear_highlights(role_id)
    return {
        "ui_state": svc.to_dict(row),
        "mutation": {"type": "clear_highlights"},
    }


def set_sort(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    field = str(args.get("field", "")).strip()
    order = str(args.get("order", "desc")).lower()
    if order not in {"asc", "desc"}:
        order = "desc"
    if not field:
        return {"error": "field is required for set_sort", "ui_state": _service(db).to_dict(_service(db).get_or_create(role_id))}
    svc = _service(db)
    row = svc.set_sort(role_id, field, order)
    return {
        "ui_state": svc.to_dict(row),
        "mutation": {"type": "set_sort", "field": field, "order": order},
    }


def reset_ui(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    svc = _service(db)
    row = svc.reset(role_id)
    return {
        "ui_state": svc.to_dict(row),
        "mutation": {"type": "reset_ui"},
    }
