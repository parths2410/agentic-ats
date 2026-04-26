const TIERS = [
  { id: "low", label: "Low", weight: 0.5 },
  { id: "med", label: "Medium", weight: 1.0 },
  { id: "high", label: "High", weight: 1.5 },
];

export function weightToTier(weight) {
  if (weight == null) return "med";
  if (weight <= 0.74) return "low";
  if (weight <= 1.24) return "med";
  return "high";
}

export function tierToWeight(id) {
  return TIERS.find((t) => t.id === id)?.weight ?? 1.0;
}

export default function WeightChips({ value, onChange, ariaLabel = "Weight" }) {
  const active = weightToTier(value);
  return (
    <div className="weight-chips" role="radiogroup" aria-label={ariaLabel}>
      {TIERS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={active === t.id}
          className={`weight-chip${active === t.id ? " active" : ""}`}
          onClick={() => onChange(t.weight)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
