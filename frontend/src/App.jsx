import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api } from "./services/api.js";
import RoleList from "./components/RoleList/RoleList.jsx";
import RoleSetup from "./components/RoleSetup/RoleSetup.jsx";
import Workspace from "./components/Workspace/Workspace.jsx";

function HealthBadge() {
  const [status, setStatus] = useState({ state: "loading", text: "checking..." });

  useEffect(() => {
    api
      .health()
      .then((data) => setStatus({ state: "ok", text: `backend: ${data.status}` }))
      .catch((err) => setStatus({ state: "error", text: `backend: ${err.message}` }));
  }, []);

  return <span className={`health-status ${status.state}`}>{status.text}</span>;
}

export default function App() {
  return (
    <>
      <nav>
        <NavLink to="/" end>Roles</NavLink>
        <NavLink to="/roles/new">New Role</NavLink>
        <NavLink to="/workspace">Workspace</NavLink>
        <span style={{ marginLeft: "auto" }}>
          <HealthBadge />
        </span>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<RoleList />} />
          <Route path="/roles/new" element={<RoleSetup />} />
          <Route path="/roles/:roleId" element={<RoleSetup />} />
          <Route path="/workspace" element={<Workspace />} />
        </Routes>
      </main>
    </>
  );
}
