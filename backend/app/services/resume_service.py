"""Orchestrates the resume → profile → score pipeline.

Per the architecture: text extraction (sync) → LLM parse → LLM score → persist.
Candidates are processed concurrently with asyncio.gather.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.llm.base import LLMProvider
from app.models.candidate import Candidate, CriterionScore
from app.models.criterion import Criterion
from app.models.role import Role
from app.pipeline import progress
from app.pipeline.text_extractor import extract_text

logger = logging.getLogger(__name__)

# Strips parenthetical hints the LLM sometimes appends to criterion names,
# e.g. "Backend Engineering Experience (weight 1.0)" -> "Backend Engineering Experience".
_NAME_NORMALIZE_RE = re.compile(r"\s*\([^)]*\)\s*$")


def _normalize_name(name: str) -> str:
    return _NAME_NORMALIZE_RE.sub("", str(name)).strip().lower()


class ResumeService:
    def __init__(self, db: Session, llm: LLMProvider) -> None:
        self.db = db
        self.llm = llm

    # ------------------------------------------------------------------
    # Upload (sync, fast): persist files and create candidate rows.
    # ------------------------------------------------------------------

    def create_candidates(
        self,
        role_id: str,
        files: list[tuple[str, bytes]],
    ) -> list[Candidate]:
        candidates: list[Candidate] = []
        for filename, data in files:
            c = Candidate(
                role_id=role_id,
                pdf_filename=filename,
                pdf_blob=data,
                status="pending",
            )
            self.db.add(c)
            candidates.append(c)
        self.db.commit()
        for c in candidates:
            self.db.refresh(c)
        return candidates

    # ------------------------------------------------------------------
    # Background processing (async): one task per candidate.
    # ------------------------------------------------------------------

    async def process_candidates_async(
        self,
        role_id: str,
        candidate_ids: list[str],
    ) -> None:
        # Snapshot role + criteria once. Both rarely change during processing,
        # and re-scoring after criteria changes goes through `rescore_role`.
        with SessionLocal() as snap_db:
            role = snap_db.get(Role, role_id)
            if role is None:
                return
            jd = role.job_description
            criteria_snapshot = [
                {
                    "id": c.id,
                    "name": c.name,
                    "description": c.description,
                    "weight": c.weight,
                }
                for c in sorted(
                    role.criteria, key=lambda c: (c.order_index, c.name)
                )
            ]

        total = len(candidate_ids)
        await progress.publish(
            role_id,
            {
                "type": "batch_started",
                "total": total,
            },
        )

        await asyncio.gather(
            *(
                self._process_one(role_id, cid, jd, criteria_snapshot, idx, total)
                for idx, cid in enumerate(candidate_ids, start=1)
            ),
            return_exceptions=True,
        )

        # Recompute ranks once at the end.
        with SessionLocal() as rank_db:
            self._recompute_ranks(rank_db, role_id)

        await progress.publish(role_id, {"type": "batch_complete"})

    async def _process_one(
        self,
        role_id: str,
        candidate_id: str,
        job_description: str,
        criteria: list[dict[str, Any]],
        index: int,
        total: int,
    ) -> None:
        async def emit(stage: str, status: str, **extra: Any) -> None:
            await progress.publish(
                role_id,
                {
                    "type": "progress",
                    "candidate_id": candidate_id,
                    "stage": stage,
                    "status": status,
                    "index": index,
                    "total": total,
                    **extra,
                },
            )

        # Stage 1: extract text from the stored PDF.
        await emit("parsing", "in_progress")
        try:
            with SessionLocal() as db:
                cand = db.get(Candidate, candidate_id)
                if cand is None or cand.pdf_blob is None:
                    raise RuntimeError("Candidate or PDF missing.")
                cand.status = "extracting"
                db.commit()
                pdf_bytes = cand.pdf_blob
                filename = cand.pdf_filename or "(unknown)"

            raw_text = await asyncio.to_thread(extract_text, pdf_bytes)
            if not raw_text.strip():
                raise RuntimeError(
                    "No text could be extracted from the PDF (likely scanned with OCR unavailable)."
                )

            # Stage 2: LLM resume parse.
            await emit("parsing", "in_progress", message="Parsing structure")
            profile = await self.llm.parse_resume(raw_text)
            name = profile.get("name") if isinstance(profile, dict) else None
            confidence = (
                profile.get("confidence_scores")
                if isinstance(profile, dict)
                else None
            )

            with SessionLocal() as db:
                cand = db.get(Candidate, candidate_id)
                if cand is None:
                    return
                cand.raw_text = raw_text
                cand.structured_profile = profile
                cand.parse_confidence = confidence
                cand.name = name
                cand.status = "scoring"
                db.commit()

            await emit("parsing", "complete", candidate_name=name)

            # Stage 3: LLM score.
            await emit("scoring", "in_progress")
            score_result = await self.llm.score_candidate(profile, job_description, criteria)

            self._persist_scores(candidate_id, score_result, criteria)

            await emit(
                "scoring",
                "complete",
                candidate_name=name,
                aggregate_score=self._read_aggregate(candidate_id),
            )
        except Exception as e:
            logger.exception("Failed to process candidate %s (%s)", candidate_id, filename if 'filename' in locals() else '?')
            with SessionLocal() as db:
                cand = db.get(Candidate, candidate_id)
                if cand is not None:
                    cand.status = "error"
                    cand.error_message = str(e)[:1000]
                    db.commit()
            await emit("error", "error", message=str(e))

    def _persist_scores(
        self,
        candidate_id: str,
        score_result: dict[str, Any],
        criteria: list[dict[str, Any]],
    ) -> None:
        raw_scores = score_result.get("scores") or []
        scores_by_name = {
            _normalize_name(s.get("criterion_name", "")): s
            for s in raw_scores
            if isinstance(s, dict)
        }

        with SessionLocal() as db:
            cand = db.get(Candidate, candidate_id)
            if cand is None:
                return
            # Wipe old scores (keeps things idempotent for re-scoring).
            db.query(CriterionScore).filter(
                CriterionScore.candidate_id == candidate_id
            ).delete(synchronize_session=False)

            total_weight = 0.0
            weighted_sum = 0.0
            matched = 0
            for c in criteria:
                key = _normalize_name(c["name"])
                hit = scores_by_name.get(key)
                if hit is None:
                    continue
                cs = CriterionScore(
                    candidate_id=candidate_id,
                    criterion_id=c["id"],
                    score=float(hit["score"]),
                    rationale=hit.get("rationale", ""),
                )
                db.add(cs)
                weight = float(c["weight"])
                total_weight += weight
                weighted_sum += weight * float(hit["score"])
                matched += 1

            if matched == 0 and criteria:
                cand.status = "error"
                cand.error_message = (
                    f"Scoring returned no usable scores. "
                    f"LLM returned {len(raw_scores)} entries; "
                    f"none matched the {len(criteria)} criteria by name."
                )
                cand.aggregate_score = None
                db.commit()
                logger.warning(
                    "Scoring matched 0/%d criteria for candidate %s. "
                    "LLM returned names: %s",
                    len(criteria),
                    candidate_id,
                    [str(s.get("criterion_name")) for s in raw_scores],
                )
                return

            cand.aggregate_score = (
                round(weighted_sum / total_weight, 2) if total_weight > 0 else None
            )
            cand.status = "complete"
            cand.error_message = None
            db.commit()

    def _read_aggregate(self, candidate_id: str) -> float | None:
        with SessionLocal() as db:
            cand = db.get(Candidate, candidate_id)
            return cand.aggregate_score if cand else None

    # ------------------------------------------------------------------
    # Re-score all candidates for a role (criteria changed).
    # ------------------------------------------------------------------

    async def rescore_role(self, role_id: str) -> None:
        with SessionLocal() as db:
            rows = db.execute(
                select(Candidate.id)
                .where(Candidate.role_id == role_id)
                .where(Candidate.structured_profile.is_not(None))
            ).all()
            ids = [r[0] for r in rows]

        if not ids:
            return

        with SessionLocal() as snap_db:
            role = snap_db.get(Role, role_id)
            if role is None:
                return
            jd = role.job_description
            criteria_snapshot = [
                {
                    "id": c.id,
                    "name": c.name,
                    "description": c.description,
                    "weight": c.weight,
                }
                for c in sorted(role.criteria, key=lambda c: (c.order_index, c.name))
            ]

        total = len(ids)
        await progress.publish(
            role_id, {"type": "batch_started", "total": total, "rescore": True}
        )

        async def one(idx: int, cid: int) -> None:
            try:
                with SessionLocal() as db:
                    cand = db.get(Candidate, cid)
                    if cand is None or cand.structured_profile is None:
                        return
                    profile = cand.structured_profile
                    cand.status = "scoring"
                    db.commit()

                await progress.publish(
                    role_id,
                    {
                        "type": "progress",
                        "candidate_id": cid,
                        "stage": "scoring",
                        "status": "in_progress",
                        "index": idx,
                        "total": total,
                    },
                )
                result = await self.llm.score_candidate(profile, jd, criteria_snapshot)
                self._persist_scores(cid, result, criteria_snapshot)
                await progress.publish(
                    role_id,
                    {
                        "type": "progress",
                        "candidate_id": cid,
                        "stage": "scoring",
                        "status": "complete",
                        "index": idx,
                        "total": total,
                    },
                )
            except Exception as e:
                logger.exception("Re-score failed for %s", cid)
                with SessionLocal() as db:
                    cand = db.get(Candidate, cid)
                    if cand is not None:
                        cand.status = "error"
                        cand.error_message = str(e)[:1000]
                        db.commit()
                await progress.publish(
                    role_id,
                    {
                        "type": "progress",
                        "candidate_id": cid,
                        "stage": "scoring",
                        "status": "error",
                        "message": str(e),
                    },
                )

        await asyncio.gather(*(one(i, cid) for i, cid in enumerate(ids, start=1)))

        with SessionLocal() as rank_db:
            self._recompute_ranks(rank_db, role_id)

        await progress.publish(role_id, {"type": "batch_complete"})

    # ------------------------------------------------------------------
    # Ranking
    # ------------------------------------------------------------------

    def _recompute_ranks(self, db: Session, role_id: str) -> None:
        rows = (
            db.execute(
                select(Candidate)
                .where(Candidate.role_id == role_id)
                .order_by(Candidate.aggregate_score.desc().nulls_last(), Candidate.created_at)
            )
            .scalars()
            .all()
        )
        rank = 0
        for c in rows:
            if c.aggregate_score is None:
                c.rank = None
                continue
            rank += 1
            c.rank = rank
        db.commit()


def candidates_for_role(db: Session, role_id: str) -> list[Candidate]:
    return list(
        db.execute(
            select(Candidate)
            .where(Candidate.role_id == role_id)
            .order_by(
                Candidate.rank.is_(None),
                Candidate.rank,
                Candidate.aggregate_score.desc().nulls_last(),
                Candidate.created_at,
            )
        ).scalars()
    )
