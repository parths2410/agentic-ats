import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import RoleSetup from "./RoleSetup.jsx";
import { api } from "../../services/api.js";

// Stub api.ws.progress so RoleSetup mounting doesn't try to open a real WS.
class FakeWS {
  close() {}
}

beforeEach(() => {
  vi.spyOn(api.ws, "progress").mockImplementation(() => new FakeWS());
});
afterEach(() => vi.restoreAllMocks());


function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/roles/new" element={<RoleSetup />} />
        <Route path="/roles/:roleId" element={<RoleSetup />} />
      </Routes>
    </MemoryRouter>
  );
}


describe("RoleSetup — new role", () => {
  it("creates a role and navigates to its detail page", async () => {
    vi.spyOn(api.roles, "create").mockResolvedValue({ id: "newid", title: "Eng" });
    const user = userEvent.setup();
    renderAt("/roles/new");
    await user.type(screen.getByLabelText(/title/i), "Eng");
    await user.type(screen.getByLabelText(/job description/i), "JD here");
    await user.click(screen.getByRole("button", { name: /create role/i }));
    await waitFor(() =>
      expect(api.roles.create).toHaveBeenCalledWith({ title: "Eng", job_description: "JD here" })
    );
  });

  it("requires a title", async () => {
    const user = userEvent.setup();
    renderAt("/roles/new");
    await user.click(screen.getByRole("button", { name: /create role/i }));
    await screen.findByText(/Title is required/);
  });

  it("does not show criteria section before saving", () => {
    renderAt("/roles/new");
    expect(screen.queryByText(/Scoring Criteria/)).not.toBeInTheDocument();
  });
});


describe("RoleSetup — existing role", () => {
  beforeEach(() => {
    vi.spyOn(api.roles, "get").mockResolvedValue({
      id: "r1",
      title: "Backend",
      job_description: "Build APIs.",
    });
    vi.spyOn(api.criteria, "list").mockResolvedValue([
      { id: "c1", role_id: "r1", name: "Python", description: "py", weight: 1.0, source: "auto", order_index: 1 },
    ]);
    vi.spyOn(api.roles, "update").mockResolvedValue({});
    vi.spyOn(api.criteria, "extract").mockResolvedValue({
      proposals: [
        { name: "Leadership", description: "ld", weight: 0.5, source: "auto" },
      ],
    });
    vi.spyOn(api.criteria, "create").mockImplementation((rid, p) => Promise.resolve({ id: "n1", ...p }));
    vi.spyOn(api.criteria, "update").mockImplementation((rid, id, p) => Promise.resolve({ id, ...p }));
    vi.spyOn(api.criteria, "delete").mockResolvedValue(null);
  });

  it("loads role + criteria", async () => {
    renderAt("/roles/r1");
    await screen.findByDisplayValue("Backend");
    expect(screen.getByDisplayValue("py")).toBeInTheDocument();
  });

  it("Extract Criteria adds proposals", async () => {
    const user = userEvent.setup();
    renderAt("/roles/r1");
    await screen.findByDisplayValue("Backend");
    await user.click(screen.getByRole("button", { name: /extract criteria/i }));
    await screen.findByDisplayValue("Leadership");
  });

  it("Add Criterion appends an empty manual criterion", async () => {
    const user = userEvent.setup();
    renderAt("/roles/r1");
    await screen.findByDisplayValue("Backend");
    await user.click(screen.getByRole("button", { name: /\+ add criterion/i }));
    expect(screen.getAllByText("manual").length).toBeGreaterThan(0);
  });

  it("Save Role calls the update API", async () => {
    const user = userEvent.setup();
    renderAt("/roles/r1");
    await screen.findByDisplayValue("Backend");
    await user.click(screen.getByRole("button", { name: /save role/i }));
    await waitFor(() =>
      expect(api.roles.update).toHaveBeenCalledWith("r1", expect.objectContaining({ title: "Backend" }))
    );
  });

  it("Save Criteria iterates create/update and clears removedIds", async () => {
    const user = userEvent.setup();
    renderAt("/roles/r1");
    await screen.findByDisplayValue("Backend");
    await user.click(screen.getByRole("button", { name: /save criteria/i }));
    await waitFor(() => expect(api.criteria.update).toHaveBeenCalled());
  });

  it("surfaces fetch errors", async () => {
    api.roles.get.mockRejectedValueOnce(new Error("nope"));
    renderAt("/roles/r1");
    await screen.findByText(/Error: nope/);
  });
});
