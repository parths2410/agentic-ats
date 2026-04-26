import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../services/api.js";
import BasicsTab from "./BasicsTab.jsx";
import CriterionCard from "./CriterionCard.jsx";
import UploadZone from "./UploadZone.jsx";
import useProgress from "../../hooks/useProgress.js";

const TABS = ["basics", "criteria", "resumes"];

function makeDraftId() {
  return `draft-${Math.random().toString(36).slice(2, 10)}`;
}

function isDraftId(id) {
  return typeof id === "string" && id.startsWith("draft-");
}

export default function RoleSetup() {
  const { roleId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isExisting = Boolean(roleId);

  const [role, setRole] = useState(null);
  const [criteria, setCriteria] = useState([]);
  const [removedIds, setRemovedIds] = useState([]);

  const [loading, setLoading] = useState(isExisting);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  const requestedTab = searchParams.get("tab") || "basics";
  const activeTab = TABS.includes(requestedTab) ? requestedTab : "basics";
  const lockedTab = !isExisting && activeTab !== "basics";
  const visibleTab = lockedTab ? "basics" : activeTab;

  function selectTab(tab) {
    if (!isExisting && tab !== "basics") return;
    const next = new URLSearchParams(searchParams);
    if (tab === "basics") next.delete("tab");
    else next.set("tab", tab);
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    if (!isExisting) return;
    let cancelled = false;
    Promise.all([api.roles.get(roleId), api.criteria.list(roleId)])
      .then(([roleData, crits]) => {
        if (cancelled) return;
        setRole(roleData);
        setCriteria(crits);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [roleId, isExisting]);

  async function handleSaveBasics({ title, job_description }) {
    setError(null);
    setStatusMsg(null);
    setSaving(true);
    try {
      if (isExisting) {
        const updated = await api.roles.update(roleId, { title, job_description });
        setRole((prev) => ({ ...(prev || {}), ...updated, title, job_description }));
        setStatusMsg("Saved.");
      } else {
        const created = await api.roles.create({ title, job_description });
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
    if (!isExisting || !role?.job_description?.trim()) {
      setError("Add a job description in Basics first.");
      return;
    }
    setExtracting(true);
    try {
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

  const { batch } = useProgress(isExisting ? roleId : null);

  if (loading) return <p className="roles-state">Loading role…</p>;

  const headerTitle = isExisting ? role?.title || "Untitled role" : "New role";

  return (
    <section className="role-setup">
      <header className="setup-header">
        <h1 className="setup-title">{headerTitle}</h1>
        {isExisting && (
          <Link to={`/roles/${roleId}/workspace`} className="setup-workspace-link">
            Open workspace →
          </Link>
        )}
      </header>

      <nav className="tab-strip" role="tablist" aria-label="Role setup sections">
        {TABS.map((tab) => {
          const locked = !isExisting && tab !== "basics";
          const isActive = visibleTab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-disabled={locked}
              className={`tab${isActive ? " active" : ""}${locked ? " locked" : ""}`}
              onClick={() => selectTab(tab)}
              title={locked ? "Save the role first" : undefined}
              disabled={locked}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          );
        })}
      </nav>

      {error && <p className="error">Error: {error}</p>}
      {statusMsg && <p className="status">{statusMsg}</p>}
      {batch?.active && (
        <p className="status">
          Processing {batch.done}/{batch.total} resumes…
        </p>
      )}

      {visibleTab === "basics" && (
        <BasicsTab
          role={role}
          isExisting={isExisting}
          saving={saving}
          onSave={handleSaveBasics}
        />
      )}

      {visibleTab === "criteria" && isExisting && (
        <div className="criteria-tab-legacy">
          <p className="hint">
            Edit names, descriptions, and weights. Add manual criteria. Remove any that don't fit.
          </p>
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
                No criteria yet. Click <strong>Extract criteria</strong> to propose some from the
                JD, or add one manually.
              </p>
            )}
          </div>
          <div className="form-actions">
            <button onClick={handleAddManual} className="btn btn-secondary">
              + Add criterion
            </button>
            <button
              onClick={handleExtract}
              disabled={extracting || !role?.job_description?.trim()}
              className="btn btn-secondary"
              title="Use the LLM to propose scoring criteria from the JD"
            >
              {extracting ? "Extracting…" : "Extract criteria"}
            </button>
            <button onClick={handleSaveCriteria} disabled={saving} className="btn btn-primary">
              {saving ? "Saving…" : "Save criteria"}
            </button>
          </div>
        </div>
      )}

      {visibleTab === "resumes" && isExisting && (
        <div className="resumes-tab-legacy">
          <p className="hint">
            Upload PDF resumes. Parsing and scoring run in the background — open the workspace to
            watch the ranked list build up.
          </p>
          <UploadZone
            roleId={roleId}
            onUploaded={() => setStatusMsg("Upload accepted. Processing started.")}
          />
        </div>
      )}
    </section>
  );
}
