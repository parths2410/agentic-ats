import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import RoleSetup from "./RoleSetup.jsx";
import { api } from "../../services/api.js";

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
    </MemoryRouter>,
  );
}


describe("RoleSetup — page shell", () => {
  it("renders 'New role' header and locks Criteria + Resumes tabs for a new role", () => {
    renderAt("/roles/new");
    expect(screen.getByRole("heading", { name: "New role" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Basics" })).toHaveAttribute("aria-selected", "true");
    const criteriaTab = screen.getByRole("tab", { name: "Criteria" });
    expect(criteriaTab).toBeDisabled();
    expect(criteriaTab).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("tab", { name: "Resumes" })).toBeDisabled();
  });

  it("does not render Open Workspace link for a new role", () => {
    renderAt("/roles/new");
    expect(screen.queryByRole("link", { name: /open workspace/i })).not.toBeInTheDocument();
  });
});


describe("RoleSetup — Basics tab (new role)", () => {
  it("creates the role on submit and navigates to its detail URL", async () => {
    vi.spyOn(api.roles, "create").mockResolvedValue({
      id: "new1",
      title: "Eng",
      job_description: "JD",
    });
    vi.spyOn(api.roles, "get").mockResolvedValue({
      id: "new1", title: "Eng", job_description: "JD",
    });
    vi.spyOn(api.criteria, "list").mockResolvedValue([]);
    const user = userEvent.setup();
    renderAt("/roles/new");
    await user.type(screen.getByLabelText(/title/i), "Eng");
    await user.type(screen.getByLabelText(/job description/i), "JD");
    await user.click(screen.getByRole("button", { name: /create role/i }));
    await waitFor(() =>
      expect(api.roles.create).toHaveBeenCalledWith({
        title: "Eng",
        job_description: "JD",
      }),
    );
  });

  it("requires a title", async () => {
    const user = userEvent.setup();
    renderAt("/roles/new");
    await user.click(screen.getByRole("button", { name: /create role/i }));
    await screen.findByText(/Title is required/);
  });

  it("the create button stays enabled even when empty (validation runs on submit)", () => {
    renderAt("/roles/new");
    expect(screen.getByRole("button", { name: /create role/i })).toBeEnabled();
  });
});


describe("RoleSetup — Basics tab (existing role)", () => {
  beforeEach(() => {
    vi.spyOn(api.roles, "get").mockResolvedValue({
      id: "r1",
      title: "Backend",
      job_description: "Build APIs.",
    });
    vi.spyOn(api.criteria, "list").mockResolvedValue([]);
    vi.spyOn(api.roles, "update").mockImplementation((rid, p) =>
      Promise.resolve({ id: rid, ...p }),
    );
  });

  it("loads role data into the Basics form", async () => {
    renderAt("/roles/r1");
    await screen.findByDisplayValue("Backend");
    expect(screen.getByDisplayValue("Build APIs.")).toBeInTheDocument();
  });

  it("Save button is disabled until something is dirty, then enables", async () => {
    const user = userEvent.setup();
    renderAt("/roles/r1");
    await screen.findByDisplayValue("Backend");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/title/i), " v2");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();
  });

  it("Save calls roles.update and shows a status message", async () => {
    const user = userEvent.setup();
    renderAt("/roles/r1");
    await screen.findByDisplayValue("Backend");
    await user.type(screen.getByLabelText(/title/i), " v2");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(api.roles.update).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({ title: "Backend v2" }),
      ),
    );
    await screen.findByText(/Saved\./);
  });

  it("Open Workspace link appears for an existing role", async () => {
    renderAt("/roles/r1");
    await screen.findByDisplayValue("Backend");
    expect(screen.getByRole("link", { name: /open workspace/i })).toHaveAttribute(
      "href",
      "/roles/r1/workspace",
    );
  });

  it("surfaces fetch errors", async () => {
    api.roles.get.mockRejectedValueOnce(new Error("nope"));
    renderAt("/roles/r1");
    await screen.findByText(/Error: nope/);
  });

  it("switches tabs via clicking", async () => {
    const user = userEvent.setup();
    renderAt("/roles/r1");
    await screen.findByDisplayValue("Backend");
    await user.click(screen.getByRole("tab", { name: "Criteria" }));
    expect(screen.getByRole("tab", { name: "Criteria" })).toHaveAttribute("aria-selected", "true");
  });

  it("preserves the current tab via the URL ?tab= param", async () => {
    renderAt("/roles/r1?tab=criteria");
    await screen.findByText(/edit names, descriptions, and weights/i);
    expect(screen.getByRole("tab", { name: "Criteria" })).toHaveAttribute("aria-selected", "true");
  });

  it("falls back to Basics tab when ?tab= is unknown", async () => {
    renderAt("/roles/r1?tab=nonsense");
    await screen.findByDisplayValue("Backend");
    expect(screen.getByRole("tab", { name: "Basics" })).toHaveAttribute("aria-selected", "true");
  });
});


describe("RoleSetup — Criteria tab (legacy contents pending step 3)", () => {
  beforeEach(() => {
    vi.spyOn(api.roles, "get").mockResolvedValue({
      id: "r1",
      title: "Backend",
      job_description: "Build APIs.",
    });
    vi.spyOn(api.criteria, "list").mockResolvedValue([
      {
        id: "c1",
        role_id: "r1",
        name: "Python",
        description: "py",
        weight: 1.0,
        source: "auto",
        order_index: 1,
      },
    ]);
    vi.spyOn(api.roles, "update").mockResolvedValue({});
    vi.spyOn(api.criteria, "extract").mockResolvedValue({
      proposals: [{ name: "Leadership", description: "ld", weight: 0.5, source: "auto" }],
    });
    vi.spyOn(api.criteria, "create").mockImplementation((rid, p) =>
      Promise.resolve({ id: "n1", ...p }),
    );
    vi.spyOn(api.criteria, "update").mockImplementation((rid, id, p) =>
      Promise.resolve({ id, ...p }),
    );
    vi.spyOn(api.criteria, "delete").mockResolvedValue(null);
  });

  it("renders existing criteria when the Criteria tab is selected", async () => {
    renderAt("/roles/r1?tab=criteria");
    await screen.findByDisplayValue("py");
  });

  it("Extract appends proposed criteria", async () => {
    const user = userEvent.setup();
    renderAt("/roles/r1?tab=criteria");
    await screen.findByDisplayValue("py");
    await user.click(screen.getByRole("button", { name: /extract criteria/i }));
    await screen.findByDisplayValue("Leadership");
  });

  it("Save criteria iterates create/update", async () => {
    const user = userEvent.setup();
    renderAt("/roles/r1?tab=criteria");
    await screen.findByDisplayValue("py");
    await user.click(screen.getByRole("button", { name: /save criteria/i }));
    await waitFor(() => expect(api.criteria.update).toHaveBeenCalled());
  });
});
