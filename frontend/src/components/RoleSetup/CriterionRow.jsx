import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import WeightChips from "./WeightChips.jsx";

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="6" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="18" r="1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6L6 18" /><path d="M6 6l12 12" />
    </svg>
  );
}

export default function CriterionRow({ criterion, onChange, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: criterion.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="criterion-row">
      <button
        type="button"
        className="criterion-grip"
        aria-label="Reorder criterion"
        {...attributes}
        {...listeners}
      >
        <GripIcon />
      </button>

      <div className="criterion-body">
        <div className="criterion-head">
          <input
            type="text"
            className="criterion-name"
            value={criterion.name}
            onChange={(e) => onChange({ ...criterion, name: e.target.value })}
            placeholder="Criterion name"
          />
          <span className="criterion-origin" title={`Source: ${criterion.source}`}>
            {(criterion.source || "manual").toUpperCase()}
          </span>
          <button
            type="button"
            className="criterion-remove"
            aria-label="Remove criterion"
            onClick={onRemove}
          >
            <CloseIcon />
          </button>
        </div>

        <textarea
          className="criterion-description"
          value={criterion.description || ""}
          onChange={(e) => onChange({ ...criterion, description: e.target.value })}
          placeholder="What signal in the resume satisfies this criterion?"
          rows={2}
        />

        <WeightChips
          value={criterion.weight}
          onChange={(w) => onChange({ ...criterion, weight: w })}
          ariaLabel={`Weight for ${criterion.name || "criterion"}`}
        />
      </div>
    </li>
  );
}
