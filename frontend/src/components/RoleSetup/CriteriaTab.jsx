import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { api } from "../../services/api.js";
import CriterionRow from "./CriterionRow.jsx";

function makeDraftId() {
  return `draft-${Math.random().toString(36).slice(2, 10)}`;
}

function isDraftId(id) {
  return typeof id === "string" && id.startsWith("draft-");
}

export default function CriteriaTab({ roleId, jobDescription, onStatus, onError }) {
  const [criteria, setCriteria] = useState(null);
  const [removedIds, setRemovedIds] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let cancelled = false;
    api.criteria.list(roleId)
      .then((data) => !cancelled && setCriteria(data))
      .catch((err) => {
        if (cancelled) return;
        setLoadFailed(true);
        onError?.(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [roleId]);

  if (loadFailed) return null;
  if (criteria === null) return <p className="roles-state">Loading criteria…</p>;

  const dirty = removedIds.length > 0
    || criteria.some((c) => isDraftId(c.id))
    || criteria.some((c, i) => c._dirty || c.order_index !== i + 1);

  function patch(index, next) {
    setCriteria((prev) =>
      prev.map((c, i) => (i === index ? { ...next, _dirty: true } : c)),
    );
  }

  function remove(index) {
    setCriteria((prev) => {
      const target = prev[index];
      if (target && !isDraftId(target.id)) {
        setRemovedIds((removed) => [...removed, target.id]);
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  function addManual() {
    setCriteria((prev) => [
      ...prev,
      {
        id: makeDraftId(),
        role_id: roleId,
        name: "",
        description: "",
        weight: 1.0,
        source: "manual",
        order_index: prev.length + 1,
      },
    ]);
  }

  async function extract() {
    if (!jobDescription?.trim()) {
      onError?.("Add a job description in Basics first.");
      return;
    }
    setExtracting(true);
    try {
      const { proposals } = await api.criteria.extract(roleId);
      const drafts = proposals.map((p, i) => ({
        id: makeDraftId(),
        role_id: roleId,
        name: p.name,
        description: p.description,
        weight: p.weight,
        source: "auto",
        order_index: criteria.length + i + 1,
      }));
      setCriteria((prev) => [...prev, ...drafts]);
      onStatus?.(`Added ${drafts.length} proposed criteria. Review, edit, then Save.`);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setExtracting(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      for (const id of removedIds) {
        await api.criteria.delete(roleId, id);
      }
      const saved = [];
      for (let i = 0; i < criteria.length; i++) {
        const c = criteria[i];
        if (!c.name.trim()) continue;
        const payload = {
          name: c.name,
          description: c.description,
          weight: c.weight,
          order_index: i + 1,
        };
        if (isDraftId(c.id)) {
          const created = await api.criteria.create(roleId, {
            ...payload,
            source: c.source || "manual",
          });
          saved.push(created);
        } else {
          const updated = await api.criteria.update(roleId, c.id, payload);
          saved.push(updated);
        }
      }
      setCriteria(saved);
      setRemovedIds([]);
      onStatus?.(`Saved ${saved.length} criteria.`);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setCriteria((prev) => {
      const oldIdx = prev.findIndex((c) => c.id === active.id);
      const newIdx = prev.findIndex((c) => c.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return prev;
      return arrayMove(prev, oldIdx, newIdx).map((c, i) => ({
        ...c,
        order_index: i + 1,
        _dirty: true,
      }));
    });
  }

  if (criteria.length === 0 && removedIds.length === 0) {
    return (
      <div className="criteria-empty">
        <p className="criteria-empty-title">No criteria yet</p>
        <div className="criteria-empty-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={extract}
            disabled={extracting || !jobDescription?.trim()}
          >
            {extracting ? "Extracting…" : "Extract from job description"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={addManual}>
            Add manually
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="criteria-tab">
      <div className="criteria-toolbar">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={extract}
          disabled={extracting || !jobDescription?.trim()}
          title="Append new proposals from the JD"
        >
          {extracting ? "Extracting…" : "Extract from JD"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={addManual}>
          + Add criterion
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={criteria.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="criteria-list">
            {criteria.map((c, i) => (
              <CriterionRow
                key={c.id}
                criterion={c}
                onChange={(next) => patch(i, next)}
                onRemove={() => remove(i)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="criteria-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={saving || !dirty}
        >
          {saving ? "Saving…" : "Save criteria"}
        </button>
      </div>
    </div>
  );
}
