"""Executors for the data-retrieval chat tools.

Each function takes a SQLAlchemy Session, a role_id, and a dict of args
(already parsed from the LLM's tool call). They return plain JSON-friendly
structures — dicts and lists of primitives — so the result can be serialized
straight into the next LLM turn.

These functions are deliberately tolerant of partial / sparse profile data
(structured profiles can have nulls and missing keys) and never raise on
"not found"; they return an explanatory message instead, since the LLM can
react to that in conversation.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.candidate import Candidate, CriterionScore
from app.models.criterion import Criterion


# ---- Helpers ----------------------------------------------------------------


def _summary(c: Candidate) -> dict[str, Any]:
    profile = c.structured_profile if isinstance(c.structured_profile, dict) else {}
    experiences = profile.get("experiences") or []
    current = experiences[0] if experiences else {}
    education = profile.get("education") or []
    edu_summary = None
    if education:
        first = education[0] or {}
        parts = [first.get("degree"), first.get("field"), first.get("institution")]
        edu_summary = " — ".join(p for p in parts if p)

    contact = profile.get("contact_info") or {}
    return {
        "id": c.id,
        "name": c.name,
        "rank": c.rank,
        "aggregate_score": c.aggregate_score,
        "current_title": current.get("title") if isinstance(current, dict) else None,
        "current_company": current.get("company") if isinstance(current, dict) else None,
        "skills": list(profile.get("skills") or []),
        "location": contact.get("location") if isinstance(contact, dict) else None,
        "education_summary": edu_summary,
        "status": c.status,
    }


def _all_candidates(db: Session, role_id: str) -> list[Candidate]:
    return list(
        db.execute(
            select(Candidate).where(Candidate.role_id == role_id)
        ).scalars()
    )


def _completed_candidates(db: Session, role_id: str) -> list[Candidate]:
    return [c for c in _all_candidates(db, role_id) if c.status == "complete"]


def _raw_sort_value(c: Candidate, sort_by: str) -> Any:
    if sort_by == "rank":
        return c.rank
    if sort_by == "name":
        return c.name
    if sort_by in {"aggregate_score", "score", "aggregate"}:
        return c.aggregate_score
    for s in (c.scores or []):
        if (s.criterion.name if s.criterion else "").lower() == sort_by.lower():
            return s.score
    return None


def _sort_key(c: Candidate, sort_by: str, desc: bool) -> Any:
    val = _raw_sort_value(c, sort_by)
    # None always sorts last, regardless of direction.
    if val is None:
        return (1, 0)
    if isinstance(val, (int, float)):
        return (0, -float(val) if desc else float(val))
    s = str(val).lower()
    if desc:
        # Negate string ordering by mapping each char to its negative codepoint.
        return (0, tuple(-ord(ch) for ch in s))
    return (0, s)


# ---- Tool executors ---------------------------------------------------------


def get_candidates(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    limit = int(args.get("limit", 50))
    offset = int(args.get("offset", 0))
    sort_by = str(args.get("sort_by", "rank"))
    sort_order = str(args.get("sort_order", "asc")).lower()

    rows = _all_candidates(db, role_id)
    desc = sort_order == "desc"
    rows.sort(key=lambda c: _sort_key(c, sort_by, desc))
    page = rows[offset : offset + limit]
    return {
        "total": len(rows),
        "returned": len(page),
        "candidates": [_summary(c) for c in page],
    }


def get_candidate_detail(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    cid = str(args.get("candidate_id", ""))
    c = db.get(Candidate, cid)
    if c is None or c.role_id != role_id:
        return {"error": "candidate_not_found", "candidate_id": cid}
    return {
        "id": c.id,
        "name": c.name,
        "status": c.status,
        "rank": c.rank,
        "aggregate_score": c.aggregate_score,
        "structured_profile": c.structured_profile,
        "parse_confidence": c.parse_confidence,
    }


def get_candidate_raw_text(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    cid = str(args.get("candidate_id", ""))
    c = db.get(Candidate, cid)
    if c is None or c.role_id != role_id:
        return {"error": "candidate_not_found", "candidate_id": cid}
    return {"id": c.id, "name": c.name, "raw_text": c.raw_text or ""}


def get_candidate_scores(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    cid = str(args.get("candidate_id", ""))
    c = db.get(Candidate, cid)
    if c is None or c.role_id != role_id:
        return {"error": "candidate_not_found", "candidate_id": cid}
    rows = db.execute(
        select(CriterionScore, Criterion)
        .join(Criterion, Criterion.id == CriterionScore.criterion_id)
        .where(CriterionScore.candidate_id == cid)
        .order_by(Criterion.order_index, Criterion.name)
    ).all()
    return {
        "id": c.id,
        "name": c.name,
        "aggregate_score": c.aggregate_score,
        "scores": [
            {
                "criterion_name": cr.name,
                "weight": cr.weight,
                "score": cs.score,
                "rationale": cs.rationale,
            }
            for cs, cr in rows
        ],
    }


# ---- search_candidates ------------------------------------------------------


def _profile_text(c: Candidate, field: str) -> list[str]:
    profile = c.structured_profile if isinstance(c.structured_profile, dict) else {}
    if field == "skills":
        return [str(s) for s in (profile.get("skills") or [])]
    if field == "companies":
        return [
            str(e.get("company") or "")
            for e in (profile.get("experiences") or [])
            if isinstance(e, dict)
        ]
    if field == "titles":
        return [
            str(e.get("title") or "")
            for e in (profile.get("experiences") or [])
            if isinstance(e, dict)
        ]
    if field == "education":
        bits: list[str] = []
        for e in profile.get("education") or []:
            if isinstance(e, dict):
                bits.extend(
                    str(e.get(k) or "")
                    for k in ("degree", "field", "institution")
                )
        return bits
    if field == "location":
        contact = profile.get("contact_info") or {}
        return [str(contact.get("location") or "")] if isinstance(contact, dict) else []
    if field == "text":
        return [c.raw_text or ""]
    return []


def _excerpt(haystack: str, needle: str, radius: int = 80) -> str:
    if not haystack:
        return ""
    idx = haystack.lower().find(needle.lower())
    if idx == -1:
        return haystack[: radius * 2].strip()
    start = max(0, idx - radius)
    end = min(len(haystack), idx + len(needle) + radius)
    snippet = haystack[start:end].strip().replace("\n", " ")
    return ("…" if start > 0 else "") + snippet + ("…" if end < len(haystack) else "")


def search_candidates(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    field = str(args.get("field", "")).lower()
    query = str(args.get("query", "")).strip()
    limit = int(args.get("limit", 50))
    if not field or not query:
        return {"error": "field and query are required", "matches": []}

    needle = query.lower()
    matches: list[dict[str, Any]] = []
    for c in _all_candidates(db, role_id):
        values = _profile_text(c, field)
        joined = " ".join(v for v in values if v)
        if not joined:
            continue
        if needle in joined.lower():
            matches.append(
                {
                    "candidate_id": c.id,
                    "name": c.name,
                    "rank": c.rank,
                    "aggregate_score": c.aggregate_score,
                    "excerpt": _excerpt(joined, query),
                }
            )
            if len(matches) >= limit:
                break
    return {"field": field, "query": query, "match_count": len(matches), "matches": matches}


# ---- compute_stats ----------------------------------------------------------


def _matches_condition(c: Candidate, field: str, condition: str | None) -> bool:
    if not condition:
        return True
    needle = condition.lower()
    haystacks = _profile_text(c, field)
    return any(needle in (h or "").lower() for h in haystacks)


def _numeric_value(c: Candidate, field: str) -> float | None:
    if field in {"aggregate_score", "aggregate", "score"}:
        return c.aggregate_score
    # criterion name match
    for s in (c.scores or []):
        if (s.criterion.name if s.criterion else "").lower() == field.lower():
            return s.score
    return None


def compute_stats(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    stat_type = str(args.get("stat_type", "")).lower()
    field = str(args.get("field", "")).lower()
    condition = args.get("condition")
    if condition is not None:
        condition = str(condition)

    candidates = _all_candidates(db, role_id)
    completed = [c for c in candidates if c.status == "complete"]

    if stat_type == "count":
        n = sum(1 for c in candidates if _matches_condition(c, field or "text", condition))
        return {
            "stat_type": "count",
            "field": field,
            "condition": condition,
            "value": n,
            "total_candidates": len(candidates),
        }

    if stat_type == "percentage":
        if not condition:
            return {"error": "percentage requires a 'condition'"}
        denominator = len(candidates)
        if denominator == 0:
            return {
                "stat_type": "percentage",
                "field": field,
                "condition": condition,
                "value": 0.0,
                "matched": 0,
                "total": 0,
            }
        matched = sum(1 for c in candidates if _matches_condition(c, field or "text", condition))
        return {
            "stat_type": "percentage",
            "field": field,
            "condition": condition,
            "value": round(100.0 * matched / denominator, 2),
            "matched": matched,
            "total": denominator,
        }

    if stat_type == "average":
        values = [v for c in completed if (v := _numeric_value(c, field)) is not None]
        if not values:
            return {"stat_type": "average", "field": field, "value": None, "n": 0}
        avg = sum(values) / len(values)
        return {
            "stat_type": "average",
            "field": field,
            "value": round(avg, 2),
            "n": len(values),
        }

    if stat_type == "distribution":
        buckets: dict[str, int] = {}
        for c in candidates:
            for v in _profile_text(c, field):
                key = (v or "").strip()
                if not key:
                    continue
                buckets[key] = buckets.get(key, 0) + 1
        ordered = sorted(buckets.items(), key=lambda kv: kv[1], reverse=True)
        return {
            "stat_type": "distribution",
            "field": field,
            "buckets": [{"value": k, "count": v} for k, v in ordered[:50]],
            "unique_values": len(buckets),
        }

    return {"error": f"unknown stat_type: {stat_type!r}"}


# ---- get_ui_state -----------------------------------------------------------
#
# M3 stub. M4 will replace this with real persistence.

def get_ui_state(db: Session, role_id: str, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "role_id": role_id,
        "highlighted_candidate_ids": [],
        "current_sort_field": None,
        "current_sort_order": None,
    }
