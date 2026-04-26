import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import App from "./App.jsx";
import { api } from "./services/api.js";

beforeEach(() => {
  vi.spyOn(api, "health").mockResolvedValue({ status: "ok" });
  vi.spyOn(api.roles, "list").mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());


describe("App", () => {
  it("renders nav and the role list landing page", async () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Roles" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Roles" })).toBeInTheDocument();
    await screen.findByText(/backend: ok/);
  });

  it("renders error state when health fails", async () => {
    api.health.mockRejectedValueOnce(new Error("down"));
    render(<MemoryRouter><App /></MemoryRouter>);
    await screen.findByText(/backend: down/);
  });
});
