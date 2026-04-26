import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

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

const wrap = (ui) => <MemoryRouter>{ui}</MemoryRouter>;


describe("RoleList", () => {
  it("renders a role row", async () => {
    render(wrap(<RoleList />));
    await screen.findByText("Backend Eng");
    expect(screen.getByText(/3 criteria · 5 candidates/)).toBeInTheDocument();
  });

  it("shows empty state when no roles exist", async () => {
    api.roles.list.mockResolvedValueOnce([]);
    render(wrap(<RoleList />));
    await screen.findByText(/No roles yet/);
  });

  it("shows error when the API fails", async () => {
    api.roles.list.mockRejectedValueOnce(new Error("nope"));
    render(wrap(<RoleList />));
    await screen.findByText(/Error: nope/);
  });

  it("delete button calls the API after confirm", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const user = userEvent.setup();
    render(wrap(<RoleList />));
    await screen.findByText("Backend Eng");
    await user.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(api.roles.delete).toHaveBeenCalledWith("r1"));
  });

  it("delete is skipped when the user cancels confirm", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    const user = userEvent.setup();
    render(wrap(<RoleList />));
    await screen.findByText("Backend Eng");
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(api.roles.delete).not.toHaveBeenCalled();
  });
});
