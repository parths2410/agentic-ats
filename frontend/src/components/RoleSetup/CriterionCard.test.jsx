import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import CriterionCard from "./CriterionCard.jsx";

const base = {
  name: "Python",
  description: "look for python",
  weight: 1.0,
  source: "auto",
};


describe("CriterionCard", () => {
  it("renders fields and source badge", () => {
    render(<CriterionCard criterion={base} onChange={() => {}} onRemove={() => {}} />);
    expect(screen.getByDisplayValue("Python")).toBeInTheDocument();
    expect(screen.getByText("auto")).toBeInTheDocument();
    expect(screen.getByText(/Weight:/)).toBeInTheDocument();
  });

  it("emits onChange with the updated name when typed into", () => {
    const onChange = vi.fn();
    render(<CriterionCard criterion={base} onChange={onChange} onRemove={() => {}} />);
    fireEvent.change(screen.getByDisplayValue("Python"), { target: { value: "Go" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: "Go" }));
  });

  it("emits onChange when description is edited", () => {
    const onChange = vi.fn();
    render(<CriterionCard criterion={base} onChange={onChange} onRemove={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/What to look for/), {
      target: { value: "new desc" },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ description: "new desc" }));
  });

  it("emits onChange with parsed weight when slider moves", () => {
    const onChange = vi.fn();
    render(<CriterionCard criterion={base} onChange={onChange} onRemove={() => {}} />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "0.5" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ weight: 0.5 }));
  });

  it("calls onRemove when the × button is clicked", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<CriterionCard criterion={base} onChange={() => {}} onRemove={onRemove} />);
    await user.click(screen.getByRole("button", { name: "×" }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("falls back to manual badge when source is missing", () => {
    render(
      <CriterionCard
        criterion={{ ...base, source: undefined }}
        onChange={() => {}}
        onRemove={() => {}}
      />
    );
    expect(screen.getByText("manual")).toBeInTheDocument();
  });
});
