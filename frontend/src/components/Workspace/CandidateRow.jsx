function fmtScore(s) {
  if (s == null) return "—";
  return Number(s).toFixed(1);
}

export default function CandidateRow({ candidate, highlighted, onSelect }) {
  const status = candidate.status || "pending";
  return (
    <li
      className={`wc-row status-${status}${highlighted ? " highlighted" : ""}`}
      onClick={() => onSelect(candidate)}
      role="button"
      tabIndex={0}
      aria-label={`Open ${candidate.name || candidate.pdf_filename || "candidate"} details`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(candidate);
        }
      }}
    >
      <div className="wc-rank">
        {candidate.rank ? `#${candidate.rank}` : "—"}
      </div>
      <div className="wc-info">
        <div className="wc-name">
          {candidate.name || candidate.pdf_filename || "(unnamed)"}
        </div>
        <div className="wc-meta">
          {candidate.pdf_filename}
          {candidate.error_message && (
            <> · <span className="wc-error-inline">{candidate.error_message}</span></>
          )}
        </div>
      </div>
      <div className="wc-score">
        {fmtScore(candidate.aggregate_score)}
        {candidate.aggregate_score != null && <span className="wc-score-denom"> / 10</span>}
      </div>
      <span className={`pill pill-${status}`}>{status}</span>
    </li>
  );
}
