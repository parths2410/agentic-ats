import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../services/api.js";
import CriterionCard from "./CriterionCard.jsx";

function makeDraftId() {
  return `draft-${Math.random().toString(36).slice(2, 10)}`;
}

function isDraftId(id) {
  return typeof id === "string" && id.startsWith("draft-");
}

export default function RoleSetup() {
  const { roleId } = useParams();
  const navigate = useNavigate();
  const isExisting = Boolean(roleId);

  const [title, setTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [criteria, setCriteria] = useState([]);
  const [removedIds, setRemovedIds] = useState([]);

  const [loading, setLoading] = useState(isExisting);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  useEffect(() => {
    if (!isExisting) return;
    let cancelled = false;
    Promise.all([api.roles.get(roleId), api.criteria.list(roleId)])
      .then(([role, crits]) => {
        if (cancelled) return;
        setTitle(role.title);
        setJobDescription(role.job_description);
        setCriteria(crits);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [roleId, isExisting]);

  async function handleSaveRole() {
    setError(null);
    setStatusMsg(null);
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setSaving(true);
    try {
      if (isExisting) {
        await api.roles.update(roleId, { title, job_description: jobDescription });
        setStatusMsg("Role saved.");
      } else {
        const created = await api.roles.create({
          title,
          job_description: jobDescription,
        });
        navigate(`/roles/${created.id}`, { replace: true });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleExtract() {
    setError(null);
    setStatusMsg(null);
    if (!isExisting) {
      setError("Save the role first, then extract criteria.");
      return;
    }
    if (!jobDescription.trim()) {
      setError("Add a job description first.");
      return;
    }
    setExtracting(true);
    try {
      // Persist the latest JD before asking the LLM to read it.
      await api.roles.update(roleId, { title, job_description: jobDescription });
      const { proposals } = await api.criteria.extract(roleId);
      const drafts = proposals.map((p) => ({
        id: makeDraftId(),
        role_id: roleId,
        name: p.name,
        description: p.description,
        weight: p.weight,
        source: "auto",
        order_index: 0,
      }));
      setCriteria((prev) => [...prev, ...drafts]);
      setStatusMsg(`Added ${drafts.length} proposed criteria. Review, edit, then Save.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setExtracting(false);
    }
  }

  function handleAddManual() {
    setCriteria((prev) => [
      ...prev,
      {
        id: makeDraftId(),
        role_id: roleId || null,
        name: "",
        description: "",
        weight: 1.0,
        source: "manual",
        order_index: 0,
      },
    ]);
  }

  function handleChangeCriterion(index, next) {
    setCriteria((prev) => prev.map((c, i) => (i === index ? next : c)));
  }

  function handleRemoveCriterion(index) {
    setCriteria((prev) => {
      const target = prev[index];
      if (target && !isDraftId(target.id)) {
        setRemovedIds((removed) => [...removed, target.id]);
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSaveCriteria() {
    setError(null);
    setStatusMsg(null);
    if (!isExisting) {
      setError("Save the role first.");
      return;
    }
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
      setStatusMsg(`Saved ${saved.length} criteria.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading role…</p>;

  return (
    <section className="role-setup">
      <header>
        <h1>{isExisting ? "Edit Role" : "New Role"}</h1>
      </header>

      {error && <p className="error">Error: {error}</p>}
      {statusMsg && <p className="status">{statusMsg}</p>}

      <div className="form-group">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Senior Backend Engineer"
        />
      </div>

      <div className="form-group">
        <label htmlFor="jd">Job Description</label>
        <textarea
          id="jd"
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          placeholder="Paste the full job description here…"
          rows={12}
        />
      </div>

      <div className="form-actions">
        <button onClick={handleSaveRole} disabled={saving} className="btn btn-primary">
          {saving ? "Saving…" : isExisting ? "Save Role" : "Create Role"}
        </button>
        {isExisting && (
          <button
            onClick={handleExtract}
            disabled={extracting || !jobDescription.trim()}
            className="btn btn-secondary"
            title="Use the LLM to propose scoring criteria from the JD"
          >
            {extracting ? "Extracting…" : "Extract Criteria"}
          </button>
        )}
      </div>

      {isExisting && (
        <>
          <header style={{ marginTop: "2rem" }}>
            <h2>Scoring Criteria</h2>
            <p className="hint">
              Edit names, descriptions, and weights. Add manual criteria. Remove any that don't fit.
            </p>
          </header>

          <div className="criteria-list">
            {criteria.map((c, i) => (
              <CriterionCard
                key={c.id}
                criterion={c}
                onChange={(next) => handleChangeCriterion(i, next)}
                onRemove={() => handleRemoveCriterion(i)}
              />
            ))}
            {criteria.length === 0 && (
              <p style={{ color: "#777" }}>
                No criteria yet. Click <strong>Extract Criteria</strong> to propose some from the
                JD, or add one manually.
              </p>
            )}
          </div>

          <div className="form-actions">
            <button onClick={handleAddManual} className="btn btn-secondary">
              + Add Criterion
            </button>
            <button
              onClick={handleSaveCriteria}
              disabled={saving}
              className="btn btn-primary"
            >
              {saving ? "Saving…" : "Save Criteria"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
