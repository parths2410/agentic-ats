import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../services/api.js";

function PencilIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export default function RoleList() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .roles.list()
      .then((data) => {
        if (!cancelled) setRoles(data || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete(id) {
    if (!confirm("Delete this role and all its data?")) return;
    try {
      await api.roles.delete(id);
      setRoles((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  return (
    <section className="roles-page">
      <header className="roles-page-header">
        <h1 className="roles-page-title">Roles</h1>
        <Link to="/roles/new" className="btn btn-primary">
          + New role
        </Link>
      </header>

      {loading && <p className="roles-state">Loading roles…</p>}
      {error && <p className="error">Error: {error}</p>}

      {!loading && !error && roles.length === 0 && (
        <div className="roles-empty">
          <p className="roles-empty-title">No roles yet</p>
          <Link to="/roles/new" className="btn btn-primary">
            + Create your first role
          </Link>
        </div>
      )}

      {roles.length > 0 && (
        <ul className="roles-list">
          {roles.map((r) => (
            <li key={r.id} className="role-row">
              <Link to={`/roles/${r.id}/workspace`} className="role-row-body">
                <div className="role-row-title">{r.title}</div>
                <div className="role-row-meta">
                  {r.criteria_count} criteria · {r.candidate_count} candidates · created{" "}
                  {new Date(r.created_at).toLocaleDateString()}
                </div>
              </Link>
              <div className="role-row-actions">
                <Link
                  to={`/roles/${r.id}`}
                  className="role-row-icon-btn"
                  aria-label="Edit role"
                  title="Edit role"
                >
                  <PencilIcon />
                </Link>
                <button
                  type="button"
                  onClick={() => handleDelete(r.id)}
                  className="role-row-icon-btn danger"
                  aria-label="Delete role"
                  title="Delete role"
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
