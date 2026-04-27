import { Link, Route, Routes, useLocation } from "react-router-dom";
import HealthBadge from "./components/HealthBadge/HealthBadge.jsx";
import RoleList from "./components/RoleList/RoleList.jsx";
import RoleSetup from "./components/RoleSetup/RoleSetup.jsx";
import Workspace from "./components/Workspace/Workspace.jsx";

function BackToRoles() {
  const { pathname } = useLocation();
  if (pathname === "/") return null;
  return (
    <Link to="/" className="back-to-roles" aria-label="Back to roles list">
      ← Roles
    </Link>
  );
}

export default function App() {
  return (
    <>
      <BackToRoles />
      <main>
        <Routes>
          <Route path="/" element={<RoleList />} />
          <Route path="/roles/new" element={<RoleSetup />} />
          <Route path="/roles/:roleId" element={<RoleSetup />} />
          <Route path="/roles/:roleId/workspace" element={<Workspace />} />
        </Routes>
      </main>
      <footer className="app-footer">
        <HealthBadge />
      </footer>
    </>
  );
}
