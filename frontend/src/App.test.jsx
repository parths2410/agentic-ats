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
  it("renders the role list landing page without a top nav", async () => {
    const { container } = render(<MemoryRouter><App /></MemoryRouter>);
    expect(container.querySelector("nav")).toBeNull();
    expect(screen.getByRole("heading", { name: "Roles" })).toBeInTheDocument();
  });

  it("renders the health badge in the footer", async () => {
    const { container } = render(<MemoryRouter><App /></MemoryRouter>);
    const footer = container.querySelector("footer.app-footer");
    expect(footer).not.toBeNull();
    const badge = await screen.findByText(/backend: ok/);
    expect(footer.contains(badge)).toBe(true);
  });

  it("renders an error state in the footer when health fails", async () => {
    api.health.mockRejectedValueOnce(new Error("down"));
    render(<MemoryRouter><App /></MemoryRouter>);
    await screen.findByText(/backend: down/);
  });
});
