import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../services/api.js";
import BasicsTab from "./BasicsTab.jsx";
import CandidateModal from "./CandidateModal.jsx";
import CriteriaTab from "./CriteriaTab.jsx";
import ResumesTab from "./ResumesTab.jsx";
import useProgress from "../../hooks/useProgress.js";

const TABS = ["basics", "criteria", "resumes"];

export default function RoleSetup() {
  const { roleId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isExisting = Boolean(roleId);

  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(isExisting);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);

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
    api.roles.get(roleId)
      .then((data) => !cancelled && setRole(data))
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
        <CriteriaTab
          roleId={roleId}
          jobDescription={role?.job_description}
          onStatus={setStatusMsg}
          onError={setError}
        />
      )}

      {visibleTab === "resumes" && isExisting && (
        <ResumesTab
          roleId={roleId}
          batch={batch}
          onStatus={setStatusMsg}
          onError={setError}
          onSelect={setSelectedCandidate}
        />
      )}

      {selectedCandidate && (
        <CandidateModal
          roleId={roleId}
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
        />
      )}
    </section>
  );
}
