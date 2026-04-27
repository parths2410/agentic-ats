import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../services/api.js";
import useProgress from "../../hooks/useProgress.js";
import CandidateModal from "../RoleSetup/CandidateModal.jsx";
import CandidateRow from "./CandidateRow.jsx";
import ChatPanel from "./ChatPanel.jsx";
import Splitter from "./Splitter.jsx";

const PROCESSING = new Set(["pending", "extracting", "scoring"]);

function sortValue(candidate, field, isLiteral) {
  if (isLiteral) {
    if (field === "name") return (candidate.name || "").toLowerCase() || null;
    if (field === "rank") return candidate.rank ?? null;
    return candidate.aggregate_score ?? null;
  }
  const hit = candidate.scores?.find(
    (s) => s.criterion_name?.toLowerCase() === field.toLowerCase(),
  );
  return hit ? hit.score : null;
}

export default function Workspace() {
  const { roleId } = useParams();
  const [role, setRole] = useState(null);
  const [criteria, setCriteria] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [highlightedIds, setHighlightedIds] = useState([]);
  const [sort, setSort] = useState(null);

  const { batch, perCandidate } = useProgress(roleId);

  const refreshCandidates = useCallback(async () => {
    if (!roleId) return;
    try {
      const list = await api.candidates.list(roleId);
      setCandidates(list);
    } catch (e) {
      setError(e.message);
    }
  }, [roleId]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const [r, c, list, ui] = await Promise.all([
          api.roles.get(roleId),
          api.criteria.list(roleId),
          api.candidates.list(roleId),
          api.chat.uiState(roleId).catch(() => null),
        ]);
        if (cancelled) return;
        setRole(r);
        setCriteria(c);
        setCandidates(list);
        if (ui) {
          setHighlightedIds(ui.highlighted_candidate_ids || []);
          if (ui.current_sort_field) {
            setSort({ field: ui.current_sort_field, order: ui.current_sort_order || "desc" });
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [roleId]);

  const applyMutations = useCallback((mut) => {
    if (!mut) return;
    if (mut.reset) {
      setHighlightedIds([]);
      setSort(null);
      return;
    }
    if (mut.clear_highlights) {
      setHighlightedIds([]);
    }
    if (mut.highlights) {
      setHighlightedIds((prev) => {
        const dropped = new Set(mut.highlights.remove || []);
        const next = prev.filter((id) => !dropped.has(id));
        const seen = new Set(next);
        for (const id of mut.highlights.add || []) {
          if (!seen.has(id)) {
            next.push(id);
            seen.add(id);
          }
        }
        return next;
      });
    }
    if (mut.re_sort) {
      setSort({ field: mut.re_sort.field, order: mut.re_sort.order || "desc" });
    }
  }, []);

  async function handleResetUI() {
    try {
      await api.chat.reset(roleId);
      setHighlightedIds([]);
      setSort(null);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    const anyProcessing = candidates.some((c) => PROCESSING.has(c.status));
    const batchActive = batch?.active;
    if (!anyProcessing && !batchActive) return;
    const t = setInterval(refreshCandidates, 1500);
    return () => clearInterval(t);
  }, [candidates, batch, refreshCandidates]);

  useEffect(() => {
    if (!perCandidate || Object.keys(perCandidate).length === 0) return;
    refreshCandidates();
  }, [perCandidate, refreshCandidates]);

  async function handleRescore() {
    setError(null);
    try {
      await api.scoring.rescore(roleId);
    } catch (e) {
      setError(e.message);
    }
  }

  const summary = useMemo(() => {
    const total = candidates.length;
    const complete = candidates.filter((c) => c.status === "complete").length;
    const errors = candidates.filter((c) => c.status === "error").length;
    const stale = candidates.filter((c) => c.stale_scores).length;
    return { total, complete, errors, stale };
  }, [candidates]);

  const highlightSet = useMemo(() => new Set(highlightedIds), [highlightedIds]);

  const orderedCandidates = useMemo(() => {
    if (!sort) return candidates;
    const arr = [...candidates];
    const desc = sort.order === "desc";
    const literal = ["aggregate", "aggregate_score", "score", "rank", "name"];
    const isLiteral = literal.includes(sort.field);
    arr.sort((a, b) => {
      const va = sortValue(a, sort.field, isLiteral);
      const vb = sortValue(b, sort.field, isLiteral);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va < vb) return desc ? 1 : -1;
      if (va > vb) return desc ? -1 : 1;
      return 0;
    });
    return arr;
  }, [candidates, sort]);

  if (loading) return <p className="roles-state">Loading workspace…</p>;
  if (error && !role) return <p className="error">{error}</p>;

  const hasUiOverride = highlightedIds.length > 0 || Boolean(sort);

  return (
    <section className="workspace-page">
      <header className="workspace-header">
        <div className="workspace-header-info">
          <h1 className="workspace-title">{role?.title}</h1>
          <p className="workspace-meta">
            {summary.complete}/{summary.total} scored
            {summary.errors > 0 && <> · {summary.errors} error{summary.errors === 1 ? "" : "s"}</>}
            {" · "}
            {criteria.length} criteria
            {highlightedIds.length > 0 && (
              <> · <strong>{highlightedIds.length}</strong> highlighted</>
            )}
            {sort && (
              <> · sorted by <strong>{sort.field}</strong> ({sort.order})</>
            )}
            {hasUiOverride && (
              <>
                {" · "}
                <button type="button" onClick={handleResetUI} className="meta-link">
                  Reset
                </button>
              </>
            )}
          </p>
        </div>
        <div className="workspace-header-actions">
          <button
            type="button"
            onClick={handleRescore}
            className="btn btn-secondary"
            disabled={summary.total === 0}
          >
            Re-score all
          </button>
          <Link to={`/roles/${roleId}`} className="workspace-setup-link">
            Setup →
          </Link>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {batch?.active && (
        <div className="status">
          Processing {batch.done}/{batch.total}…
        </div>
      )}

      {summary.stale > 0 && (
        <div className="banner banner-warn" role="status">
          Scores are out of date — criteria changed.{" "}
          <button onClick={handleRescore} className="link-btn">
            Re-score now
          </button>
        </div>
      )}

      <Splitter
        storageKey="workspace.split.fraction"
        defaultFraction={0.4}
        min={0.25}
        max={0.75}
        left={
          candidates.length === 0 ? (
            <div className="workspace-empty">
              <p className="workspace-empty-title">No candidates yet</p>
              <Link to={`/roles/${roleId}?tab=resumes`} className="btn btn-primary">
                Upload resumes →
              </Link>
            </div>
          ) : (
            <ul className="wc-list">
              {orderedCandidates.map((c) => (
                <CandidateRow
                  key={c.id}
                  candidate={c}
                  highlighted={highlightSet.has(c.id)}
                  onSelect={setSelectedCandidate}
                />
              ))}
            </ul>
          )
        }
        right={<ChatPanel roleId={roleId} onMutations={applyMutations} />}
      />

      {selectedCandidate && (
        <CandidateModal
          roleId={roleId}
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
        />
      )}
    </section>
  );
}
