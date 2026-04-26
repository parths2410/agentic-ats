import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../services/api.js";

export default function RoleList() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

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
    <section>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Roles</h1>
        <button onClick={() => navigate("/roles/new")} className="btn btn-primary">
          + New Role
        </button>
      </header>

      {loading && <p>Loading roles…</p>}
      {error && <p className="error">Error: {error}</p>}
      {!loading && !error && roles.length === 0 && (
        <p style={{ color: "#777" }}>
          No roles yet. <Link to="/roles/new">Create your first role</Link>.
        </p>
      )}

      {roles.length > 0 && (
        <ul className="role-list">
          {roles.map((r) => (
            <li key={r.id} className="role-card">
              <div>
                <Link to={`/roles/${r.id}`} className="role-title">
                  {r.title}
                </Link>
                <div className="role-meta">
                  {r.criteria_count} criteria · {r.candidate_count} candidates · created{" "}
                  {new Date(r.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="role-actions">
                <Link to={`/roles/${r.id}`} className="btn btn-secondary">
                  Open
                </Link>
                <button onClick={() => handleDelete(r.id)} className="btn btn-danger">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
