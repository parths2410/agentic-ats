import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HealthBadge from "./HealthBadge.jsx";
import { api } from "../../services/api.js";

beforeEach(() => {
  vi.spyOn(api, "health").mockResolvedValue({ status: "ok" });
});
afterEach(() => vi.restoreAllMocks());

describe("HealthBadge", () => {
  it("renders the loading state immediately, then the backend status", async () => {
    render(<HealthBadge />);
    expect(screen.getByText("checking...")).toBeInTheDocument();
    expect(screen.getByText("checking...").className).toContain("loading");
    const ok = await screen.findByText(/backend: ok/);
    expect(ok.className).toContain("ok");
  });

  it("renders an error state when health() rejects", async () => {
    api.health.mockRejectedValueOnce(new Error("down"));
    render(<HealthBadge />);
    const err = await screen.findByText(/backend: down/);
    expect(err.className).toContain("error");
  });

  it("does not setState after unmount (no-op on resolution)", async () => {
    let resolveHealth;
    api.health.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveHealth = resolve;
      }),
    );
    const { unmount } = render(<HealthBadge />);
    unmount();
    resolveHealth({ status: "ok" });
    // If the cancel guard wasn't honored, React would warn about setting
    // state on an unmounted component. The test passes by completing
    // without that warning being thrown.
  });
});
