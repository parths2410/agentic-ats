import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import RoleList from "./RoleList.jsx";
import { api } from "../../services/api.js";

beforeEach(() => {
  vi.spyOn(api.roles, "list").mockResolvedValue([
    {
      id: "r1",
      title: "Backend Eng",
      criteria_count: 3,
      candidate_count: 5,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);
  vi.spyOn(api.roles, "delete").mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

const renderWithRoutes = (initial = "/") => render(
  <MemoryRouter initialEntries={[initial]}>
    <Routes>
      <Route path="/" element={<RoleList />} />
      <Route path="/roles/new" element={<div>NEW ROLE PAGE</div>} />
      <Route path="/roles/:id" element={<div>ROLE SETUP PAGE</div>} />
      <Route path="/roles/:id/workspace" element={<div>ROLE WORKSPACE PAGE</div>} />
    </Routes>
  </MemoryRouter>,
);


describe("RoleList", () => {
  it("renders the sticky header with title and the new-role button", async () => {
    renderWithRoutes();
    expect(screen.getByRole("heading", { name: "Roles" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new role/i })).toBeInTheDocument();
    await screen.findByText("Backend Eng");
  });

  it("the new-role button navigates to /roles/new", async () => {
    const user = userEvent.setup();
    renderWithRoutes();
    await screen.findByText("Backend Eng");
    await user.click(screen.getByRole("link", { name: /new role/i }));
    expect(screen.getByText("NEW ROLE PAGE")).toBeInTheDocument();
  });

  it("renders a role row with title and meta line", async () => {
    renderWithRoutes();
    await screen.findByText("Backend Eng");
    expect(screen.getByText(/3 criteria · 5 candidates/)).toBeInTheDocument();
  });

  it("clicking the row body navigates to the workspace", async () => {
    const user = userEvent.setup();
    renderWithRoutes();
    await user.click(await screen.findByText("Backend Eng"));
    expect(screen.getByText("ROLE WORKSPACE PAGE")).toBeInTheDocument();
  });

  it("clicking the edit icon navigates to the role setup page", async () => {
    const user = userEvent.setup();
    renderWithRoutes();
    await screen.findByText("Backend Eng");
    await user.click(screen.getByRole("link", { name: /edit role/i }));
    expect(screen.getByText("ROLE SETUP PAGE")).toBeInTheDocument();
  });

  it("clicking the delete icon confirms then calls the API and removes the row", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const user = userEvent.setup();
    renderWithRoutes();
    await screen.findByText("Backend Eng");
    await user.click(screen.getByRole("button", { name: /delete role/i }));
    await waitFor(() => expect(api.roles.delete).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(screen.queryByText("Backend Eng")).not.toBeInTheDocument());
  });

  it("delete is skipped when the user cancels confirm", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    const user = userEvent.setup();
    renderWithRoutes();
    await screen.findByText("Backend Eng");
    await user.click(screen.getByRole("button", { name: /delete role/i }));
    expect(api.roles.delete).not.toHaveBeenCalled();
  });

  it("alerts when the delete API fails", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    api.roles.delete.mockRejectedValueOnce(new Error("boom"));
    const user = userEvent.setup();
    renderWithRoutes();
    await screen.findByText("Backend Eng");
    await user.click(screen.getByRole("button", { name: /delete role/i }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("boom")));
  });

  it("renders the empty hero state when there are no roles", async () => {
    api.roles.list.mockResolvedValueOnce([]);
    renderWithRoutes();
    await screen.findByText(/No roles yet/);
    expect(screen.getByRole("link", { name: /create your first role/i })).toBeInTheDocument();
  });

  it("the empty-state CTA navigates to /roles/new", async () => {
    api.roles.list.mockResolvedValueOnce([]);
    const user = userEvent.setup();
    renderWithRoutes();
    await screen.findByText(/No roles yet/);
    await user.click(screen.getByRole("link", { name: /create your first role/i }));
    expect(screen.getByText("NEW ROLE PAGE")).toBeInTheDocument();
  });

  it("shows error when the API fails", async () => {
    api.roles.list.mockRejectedValueOnce(new Error("nope"));
    renderWithRoutes();
    await screen.findByText(/Error: nope/);
  });
});
