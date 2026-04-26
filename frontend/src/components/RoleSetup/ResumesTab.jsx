import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../services/api.js";
import UploadZone from "./UploadZone.jsx";

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6L6 18" /><path d="M6 6l12 12" />
    </svg>
  );
}

function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtScore(s) {
  if (s == null) return "—";
  return Number(s).toFixed(1);
}

export default function ResumesTab({ roleId, batch, onStatus, onError, onSelect }) {
  const [candidates, setCandidates] = useState(null);
  const [rescoring, setRescoring] = useState(false);

  async function refresh() {
    try {
      const list = await api.candidates.list(roleId);
      // newest first
      list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      setCandidates(list);
    } catch (err) {
      onError?.(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [roleId]);

  // While a batch is processing, candidate statuses change in the background.
  // Refetch on every batch tick.
  useEffect(() => {
    if (!batch?.active) return;
    refresh();
  }, [batch?.active, batch?.done]);

  async function handleDelete(candidate, e) {
    e.stopPropagation();
    if (!confirm(`Delete ${candidate.name || candidate.pdf_filename}?`)) return;
    try {
      await api.candidates.delete(roleId, candidate.id);
      setCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
    } catch (err) {
      onError?.(err.message);
    }
  }

  async function handleRescore() {
    setRescoring(true);
    try {
      await api.scoring.rescore(roleId);
      onStatus?.("Re-scoring started.");
    } catch (err) {
      onError?.(err.message);
    } finally {
      setRescoring(false);
    }
  }

  if (candidates === null) return <p className="roles-state">Loading resumes…</p>;

  const total = candidates.length;
  const complete = candidates.filter((c) => c.status === "complete").length;
  const errored = candidates.filter((c) => c.status === "error").length;

  return (
    <div className="resumes-tab">
      <UploadZone
        roleId={roleId}
        onUploaded={() => {
          onStatus?.("Upload accepted. Processing started.");
          refresh();
        }}
      />

      {total > 0 && (
        <div className="resumes-status-line">
          <span>
            {complete} of {total} processed
            {errored > 0 && <> · {errored} error{errored === 1 ? "" : "s"}</>}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRescore}
            disabled={rescoring || total === 0}
          >
            {rescoring ? "Starting…" : "Re-score all"}
          </button>
        </div>
      )}

      {total === 0 && (
        <p className="resumes-empty-hint">Upload PDFs above to get started.</p>
      )}

      {total > 0 && (
        <ul className="resume-list">
          {candidates.map((c) => (
            <li
              key={c.id}
              className={`resume-row status-${c.status}`}
              onClick={() => onSelect?.(c)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect?.(c);
                }
              }}
            >
              <div className="resume-name">
                <div className="n">{c.name || c.pdf_filename || "(unnamed)"}</div>
                <div className="f">
                  {c.pdf_filename}
                  {c.created_at && <> · uploaded {timeAgo(c.created_at)}</>}
                </div>
                {c.error_message && (
                  <div className="resume-error-line">Failed: {c.error_message}</div>
                )}
              </div>
              <div className="resume-score">
                {fmtScore(c.aggregate_score)}
                {c.aggregate_score != null && <span className="small"> / 5</span>}
              </div>
              <span className={`pill pill-${c.status}`}>{c.status}</span>
              <button
                type="button"
                className="resume-remove"
                aria-label={`Delete ${c.name || c.pdf_filename || "candidate"}`}
                onClick={(e) => handleDelete(c, e)}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      {total > 0 && (
        <div className="resumes-footer">
          <Link to={`/roles/${roleId}/workspace`} className="resumes-footer-link">
            View full ranking →
          </Link>
        </div>
      )}
    </div>
  );
}
