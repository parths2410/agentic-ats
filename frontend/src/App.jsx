import { Route, Routes } from "react-router-dom";
import HealthBadge from "./components/HealthBadge/HealthBadge.jsx";
import RoleList from "./components/RoleList/RoleList.jsx";
import RoleSetup from "./components/RoleSetup/RoleSetup.jsx";
import Workspace from "./components/Workspace/Workspace.jsx";

export default function App() {
  return (
    <>
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
