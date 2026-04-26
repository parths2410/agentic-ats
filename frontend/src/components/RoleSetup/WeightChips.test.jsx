import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import WeightChips, { weightToTier, tierToWeight } from "./WeightChips.jsx";


describe("weightToTier", () => {
  it("maps boundaries to expected tiers", () => {
    expect(weightToTier(0)).toBe("low");
    expect(weightToTier(0.5)).toBe("low");
    expect(weightToTier(0.74)).toBe("low");
    expect(weightToTier(0.75)).toBe("med");
    expect(weightToTier(1.0)).toBe("med");
    expect(weightToTier(1.24)).toBe("med");
    expect(weightToTier(1.25)).toBe("high");
    expect(weightToTier(2.0)).toBe("high");
  });

  it("defaults to medium when value is null/undefined", () => {
    expect(weightToTier(null)).toBe("med");
    expect(weightToTier(undefined)).toBe("med");
  });
});


describe("tierToWeight", () => {
  it("maps tier ids to canonical weights", () => {
    expect(tierToWeight("low")).toBe(0.5);
    expect(tierToWeight("med")).toBe(1.0);
    expect(tierToWeight("high")).toBe(1.5);
  });

  it("returns 1.0 for unknown ids", () => {
    expect(tierToWeight("bogus")).toBe(1.0);
  });
});


describe("WeightChips", () => {
  it("marks the active chip via aria-checked", () => {
    render(<WeightChips value={1.0} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Medium" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Low" })).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange with the canonical weight when a chip is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<WeightChips value={1.0} onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "High" }));
    expect(onChange).toHaveBeenCalledWith(1.5);
  });

  it("supports a custom aria-label on the group", () => {
    render(<WeightChips value={0.5} onChange={() => {}} ariaLabel="Weight for X" />);
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-label", "Weight for X");
  });
});
