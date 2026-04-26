import { useEffect, useState } from "react";
import { api } from "../../services/api.js";

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6L6 18" /><path d="M6 6l12 12" />
    </svg>
  );
}

function fmtScore(s) {
  if (s == null) return "—";
  return Number(s).toFixed(1);
}

function ConfidencePills({ confidence }) {
  if (!confidence || typeof confidence !== "object") return null;
  const entries = Object.entries(confidence).filter(([, v]) => v != null);
  if (entries.length === 0) return null;
  return (
    <div className="modal-conf-row">
      {entries.map(([key, val]) => (
        <span key={key} className="modal-conf-pill">{key}: {String(val)}</span>
      ))}
    </div>
  );
}

export default function CandidateModal({ roleId, candidate, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setLoadError(null);
    api.candidates.get(roleId, candidate.id)
      .then((d) => !cancelled && setDetail(d))
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [roleId, candidate.id]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const display = detail || candidate;
  const summary = display.structured_profile?.summary;
  const scores = detail?.scores || [];
  const fileSize = candidate.pdf_filename ? "" : "";

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Candidate details"
    >
      <div className="modal-shell" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-header-info">
            <span className="modal-h-title">
              {display.name || display.pdf_filename || "(unnamed)"}
            </span>
            {display.pdf_filename && (
              <span className="modal-h-meta">{display.pdf_filename}{fileSize}</span>
            )}
          </div>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="modal-body">
          <div className="modal-pdf-pane">
            <iframe
              title={`PDF for ${display.name || display.pdf_filename || "candidate"}`}
              src={api.candidates.pdfUrl(roleId, candidate.id)}
              className="modal-pdf-frame"
            />
          </div>

          <div className="modal-info-pane">
            <div className="modal-agg-banner">
              <span className="modal-agg-num">{fmtScore(display.aggregate_score)}</span>
              <span className="modal-agg-denom">/ 5 aggregate</span>
              <span className={`pill pill-${display.status}`}>{display.status}</span>
            </div>

            {loadError && <p className="error">Error loading detail: {loadError}</p>}
            {!detail && !loadError && (
              <p className="modal-loading">Loading details…</p>
            )}

            {summary && (
              <>
                <h3 className="modal-section-title">Summary</h3>
                <p className="modal-summary">{summary}</p>
              </>
            )}

            {detail?.parse_confidence && (
              <>
                <h3 className="modal-section-title">Parse confidence</h3>
                <ConfidencePills confidence={detail.parse_confidence} />
              </>
            )}

            {scores.length > 0 && (
              <>
                <h3 className="modal-section-title">Score breakdown</h3>
                <ul className="modal-score-list">
                  {scores.map((s) => (
                    <li key={s.criterion_id}>
                      <div className="modal-score-head">
                        <strong>{s.criterion_name}</strong>
                        <span className="modal-score-num">
                          {fmtScore(s.score)}
                          {" "}
                          <span className="modal-score-weight">× {s.weight}</span>
                        </span>
                      </div>
                      {s.rationale && (
                        <p className="modal-score-rationale">{s.rationale}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
