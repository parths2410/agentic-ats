"""UI state service — owns reads/writes of the per-role highlight + sort row.

Action tools call into this service; the chat reset endpoint also routes
through here. The row is auto-created on first access so callers don't have
to handle the "not yet initialized" case.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models.ui_state import UIState


def _new_state(role_id: str) -> UIState:
    return UIState(
        role_id=role_id,
        highlighted_candidate_ids=[],
        sort_field=None,
        sort_order=None,
    )


class UIStateService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_or_create(self, role_id: str) -> UIState:
        row = self.db.get(UIState, role_id)
        if row is None:
            row = _new_state(role_id)
            self.db.add(row)
            self.db.commit()
            self.db.refresh(row)
        return row

    def to_dict(self, row: UIState) -> dict[str, Any]:
        return {
            "role_id": row.role_id,
            "highlighted_candidate_ids": list(row.highlighted_candidate_ids or []),
            "current_sort_field": row.sort_field,
            "current_sort_order": row.sort_order,
        }

    def add_highlights(self, role_id: str, candidate_ids: list[str]) -> UIState:
        row = self.get_or_create(role_id)
        existing = list(row.highlighted_candidate_ids or [])
        seen = set(existing)
        for cid in candidate_ids:
            if cid not in seen:
                existing.append(cid)
                seen.add(cid)
        row.highlighted_candidate_ids = existing
        self.db.commit()
        self.db.refresh(row)
        return row

    def remove_highlights(self, role_id: str, candidate_ids: list[str]) -> UIState:
        row = self.get_or_create(role_id)
        drop = set(candidate_ids)
        row.highlighted_candidate_ids = [
            c for c in (row.highlighted_candidate_ids or []) if c not in drop
        ]
        self.db.commit()
        self.db.refresh(row)
        return row

    def replace_highlights(self, role_id: str, candidate_ids: list[str]) -> UIState:
        row = self.get_or_create(role_id)
        # Preserve order of input, dedupe.
        seen: set[str] = set()
        out: list[str] = []
        for cid in candidate_ids:
            if cid not in seen:
                out.append(cid)
                seen.add(cid)
        row.highlighted_candidate_ids = out
        self.db.commit()
        self.db.refresh(row)
        return row

    def clear_highlights(self, role_id: str) -> UIState:
        row = self.get_or_create(role_id)
        row.highlighted_candidate_ids = []
        self.db.commit()
        self.db.refresh(row)
        return row

    def set_sort(self, role_id: str, field: str, order: str = "desc") -> UIState:
        row = self.get_or_create(role_id)
        row.sort_field = field
        row.sort_order = order
        self.db.commit()
        self.db.refresh(row)
        return row

    def reset(self, role_id: str) -> UIState:
        row = self.get_or_create(role_id)
        row.highlighted_candidate_ids = []
        row.sort_field = None
        row.sort_order = None
        self.db.commit()
        self.db.refresh(row)
        return row
