import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";

import CriterionRow from "./CriterionRow.jsx";


function wrap(criterion, handlers = {}) {
  return render(
    <DndContext>
      <SortableContext items={[criterion.id]}>
        <ul>
          <CriterionRow
            criterion={criterion}
            onChange={handlers.onChange || (() => {})}
            onRemove={handlers.onRemove || (() => {})}
          />
        </ul>
      </SortableContext>
    </DndContext>,
  );
}

const sample = {
  id: "c1",
  role_id: "r1",
  name: "Python",
  description: "py",
  weight: 1.0,
  source: "auto",
  order_index: 1,
};


describe("CriterionRow", () => {
  it("renders name, description, origin marker, and weight chips", () => {
    wrap(sample);
    expect(screen.getByDisplayValue("Python")).toBeInTheDocument();
    expect(screen.getByDisplayValue("py")).toBeInTheDocument();
    expect(screen.getByText("AUTO")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Medium" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("calls onChange with updated name when the name input changes", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    wrap(sample, { onChange });
    await user.type(screen.getByDisplayValue("Python"), "!");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Python!" }));
  });

  it("calls onChange with updated description when the textarea changes", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    wrap(sample, { onChange });
    await user.type(screen.getByDisplayValue("py"), "X");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ description: "pyX" }));
  });

  it("calls onChange with the new weight when a chip is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    wrap(sample, { onChange });
    await user.click(screen.getByRole("radio", { name: "High" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ weight: 1.5 }));
  });

  it("calls onRemove when the remove button is clicked", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    wrap(sample, { onRemove });
    await user.click(screen.getByRole("button", { name: /remove criterion/i }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("renders the MANUAL marker when source is 'manual'", () => {
    wrap({ ...sample, source: "manual" });
    expect(screen.getByText("MANUAL")).toBeInTheDocument();
  });

  it("renders MANUAL when source is missing", () => {
    wrap({ ...sample, source: undefined });
    expect(screen.getByText("MANUAL")).toBeInTheDocument();
  });
});
