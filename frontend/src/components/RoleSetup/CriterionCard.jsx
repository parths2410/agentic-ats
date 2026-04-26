export default function CriterionCard({ criterion, onChange, onRemove }) {
  return (
    <div className="criterion-card">
      <div className="criterion-row">
        <input
          type="text"
          value={criterion.name}
          onChange={(e) => onChange({ ...criterion, name: e.target.value })}
          placeholder="Criterion name"
          className="criterion-name"
        />
        <span className={`badge badge-${criterion.source || "manual"}`}>
          {criterion.source || "manual"}
        </span>
        <button onClick={onRemove} className="btn btn-danger btn-sm" title="Remove criterion">
          ×
        </button>
      </div>
      <textarea
        value={criterion.description}
        onChange={(e) => onChange({ ...criterion, description: e.target.value })}
        placeholder="What to look for in a resume to evaluate this criterion"
        rows={2}
        className="criterion-description"
      />
      <div className="criterion-row">
        <label className="weight-label">
          Weight: <strong>{criterion.weight.toFixed(2)}</strong>
        </label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={criterion.weight}
          onChange={(e) =>
            onChange({ ...criterion, weight: parseFloat(e.target.value) })
          }
          className="weight-slider"
        />
      </div>
    </div>
  );
}
