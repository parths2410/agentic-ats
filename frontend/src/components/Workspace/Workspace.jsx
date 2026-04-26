import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../services/api.js";
import useProgress from "../../hooks/useProgress.js";
import ChatPanel from "./ChatPanel.jsx";

const PROCESSING = new Set(["pending", "extracting", "scoring"]);

function fmtScore(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toFixed(2);
}

function sortValue(candidate, field, isLiteral) {
  if (isLiteral) {
    if (field === "name") return (candidate.name || "").toLowerCase() || null;
    if (field === "rank") return candidate.rank ?? null;
    return candidate.aggregate_score ?? null;
  }
  // Treat as criterion name.
  const hit = candidate.scores?.find(
    (s) => s.criterion_name?.toLowerCase() === field.toLowerCase(),
  );
  return hit ? hit.score : null;
}

function StatusBadge({ status }) {
  return <span className={`status-badge status-${status}`}>{status}</span>;
}

function CandidateCard({ candidate, onExpand, expanded, detail, onDelete, highlighted }) {
  const expandable = candidate.status === "complete";
  return (
    <li className={`candidate-card status-${candidate.status}${highlighted ? " highlighted" : ""}`}>
      <div className="candidate-row">
        <div className="candidate-rank">
          {candidate.rank ? `#${candidate.rank}` : "—"}
        </div>
        <div className="candidate-main">
          <div className="candidate-name">
            {candidate.name || candidate.pdf_filename || "(unnamed)"}
            <StatusBadge status={candidate.status} />
          </div>
          <div className="candidate-meta">
            {candidate.pdf_filename && (
              <span className="hint">{candidate.pdf_filename}</span>
            )}
            {candidate.error_message && (
              <span className="error-inline">{candidate.error_message}</span>
            )}
          </div>
          {candidate.scores.length > 0 && (
            <div className="mini-scores">
              {candidate.scores.map((s) => (
                <span key={s.criterion_id} className="mini-score" title={s.rationale}>
                  <span className="mini-score-name">{s.criterion_name}</span>
                  <span className="mini-score-val">{fmtScore(s.score)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="candidate-aggregate">
          <div className="agg-num">{fmtScore(candidate.aggregate_score)}</div>
          <div className="hint">aggregate</div>
        </div>
        <div className="candidate-actions">
          {expandable && (
            <button
              onClick={onExpand}
              className="btn btn-secondary btn-sm"
              title="Expand candidate detail"
            >
              {expanded ? "Hide" : "Expand"}
            </button>
          )}
          <button onClick={onDelete} className="btn btn-danger btn-sm" title="Remove candidate">
            ×
          </button>
        </div>
      </div>

      {expanded && detail && (
        <div className="candidate-detail">
          {detail.structured_profile?.summary && (
            <p className="profile-summary">{detail.structured_profile.summary}</p>
          )}

          <section className="profile-section">
            <h4>Score breakdown</h4>
            <ul className="rationale-list">
              {detail.scores.map((s) => (
                <li key={s.criterion_id}>
                  <div className="rationale-head">
                    <strong>{s.criterion_name}</strong>
                    <span className="rationale-score">
                      {fmtScore(s.score)} <span className="hint">× weight {s.weight}</span>
                    </span>
                  </div>
                  <p className="rationale-text">{s.rationale}</p>
                </li>
              ))}
            </ul>
          </section>

          {detail.structured_profile?.experiences?.length > 0 && (
            <section className="profile-section">
              <h4>Experience</h4>
              <ul className="profile-list">
                {detail.structured_profile.experiences.map((e, i) => (
                  <li key={i}>
                    <div>
                      <strong>{e.title || "(role)"}</strong>
                      {e.company && <> @ {e.company}</>}
                    </div>
                    <div className="hint">
                      {e.start_date} – {e.end_date}
                    </div>
                    {e.description && <p>{e.description}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detail.structured_profile?.education?.length > 0 && (
            <section className="profile-section">
              <h4>Education</h4>
              <ul className="profile-list">
                {detail.structured_profile.education.map((e, i) => (
                  <li key={i}>
                    {e.degree} {e.field && `in ${e.field}`} — {e.institution} ({e.year})
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detail.structured_profile?.skills?.length > 0 && (
            <section className="profile-section">
              <h4>Skills</h4>
              <p>{detail.structured_profile.skills.join(", ")}</p>
            </section>
          )}
        </div>
      )}
    </li>
  );
}

export default function Workspace() {
  const { roleId } = useParams();
  const [role, setRole] = useState(null);
  const [criteria, setCriteria] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [details, setDetails] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [highlightedIds, setHighlightedIds] = useState([]);
  const [sort, setSort] = useState(null); // { field, order } or null

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

  // While processing, refetch the candidate list periodically so scores
  // appear as they land. The WS hook tells us when *something* changed.
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

  async function handleExpand(candidate) {
    if (expandedId === candidate.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(candidate.id);
    if (!details[candidate.id]) {
      try {
        const d = await api.candidates.get(roleId, candidate.id);
        setDetails((prev) => ({ ...prev, [candidate.id]: d }));
      } catch (e) {
        setError(e.message);
      }
    }
  }

  async function handleDelete(candidate) {
    if (!confirm(`Remove ${candidate.name || candidate.pdf_filename}?`)) return;
    try {
      await api.candidates.delete(roleId, candidate.id);
      setCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
    } catch (e) {
      setError(e.message);
    }
  }

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
    return { total, complete, errors };
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
      // Nulls always last regardless of direction.
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va < vb) return desc ? 1 : -1;
      if (va > vb) return desc ? -1 : 1;
      return 0;
    });
    return arr;
  }, [candidates, sort]);

  if (loading) return <p>Loading workspace…</p>;
  if (error && !role) return <p className="error">{error}</p>;

  return (
    <section className="workspace workspace-with-chat">
      <div className="workspace-main">
      <header className="workspace-header">
        <div>
          <h1>{role?.title}</h1>
          <p className="hint">
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
          </p>
        </div>
        <div className="workspace-actions">
          <Link to={`/roles/${roleId}`} className="btn btn-secondary">
            Edit role / criteria
          </Link>
          {(highlightedIds.length > 0 || sort) && (
            <button
              onClick={handleResetUI}
              className="btn btn-secondary"
              title="Clear highlights and reset sort"
            >
              Reset view
            </button>
          )}
          <button
            onClick={handleRescore}
            className="btn btn-secondary"
            disabled={summary.total === 0}
          >
            Re-score all
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {batch?.active && (
        <div className="status">
          Processing {batch.done}/{batch.total}…
        </div>
      )}

      {candidates.length === 0 ? (
        <p style={{ color: "#777", marginTop: "1.5rem" }}>
          No candidates yet. <Link to={`/roles/${roleId}`}>Upload resumes</Link>.
        </p>
      ) : (
        <ul className="candidate-list">
          {orderedCandidates.map((c) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              expanded={expandedId === c.id}
              detail={details[c.id]}
              onExpand={() => handleExpand(c)}
              onDelete={() => handleDelete(c)}
              highlighted={highlightSet.has(c.id)}
            />
          ))}
        </ul>
      )}
      </div>
      <ChatPanel roleId={roleId} onMutations={applyMutations} />
    </section>
  );
}
