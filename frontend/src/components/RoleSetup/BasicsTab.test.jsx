import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import BasicsTab from "./BasicsTab.jsx";


describe("BasicsTab", () => {
  it("renders empty inputs and a 'Create role' button when no role provided", () => {
    render(<BasicsTab role={null} isExisting={false} saving={false} onSave={vi.fn()} />);
    expect(screen.getByLabelText(/title/i)).toHaveValue("");
    expect(screen.getByLabelText(/job description/i)).toHaveValue("");
    expect(screen.getByRole("button", { name: /create role/i })).toBeInTheDocument();
  });

  it("hydrates inputs from the role prop and labels the button 'Save'", () => {
    const role = { id: "r1", title: "Backend", job_description: "Build APIs." };
    render(<BasicsTab role={role} isExisting={true} saving={false} onSave={vi.fn()} />);
    expect(screen.getByLabelText(/title/i)).toHaveValue("Backend");
    expect(screen.getByLabelText(/job description/i)).toHaveValue("Build APIs.");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("blocks submit and shows a validation error when title is empty", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<BasicsTab role={null} isExisting={false} saving={false} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /create role/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Title is required/)).toBeInTheDocument();
  });

  it("calls onSave with trimmed values on submit", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<BasicsTab role={null} isExisting={false} saving={false} onSave={onSave} />);
    await user.type(screen.getByLabelText(/title/i), "  Eng  ");
    await user.type(screen.getByLabelText(/job description/i), "JD body");
    await user.click(screen.getByRole("button", { name: /create role/i }));
    expect(onSave).toHaveBeenCalledWith({ title: "Eng", job_description: "JD body" });
  });

  it("shows 'Saving…' label and disables submit while saving", () => {
    render(<BasicsTab role={null} isExisting={false} saving={true} onSave={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /saving/i });
    expect(btn).toBeDisabled();
  });

  it("re-enables Save once the user edits the form", async () => {
    const role = { id: "r1", title: "Backend", job_description: "JD" };
    const user = userEvent.setup();
    render(<BasicsTab role={role} isExisting={true} saving={false} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    await user.clear(screen.getByLabelText(/title/i));
    await user.type(screen.getByLabelText(/title/i), "Backend Eng");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();
  });

  it("re-hydrates when the role prop changes (e.g. after save)", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <BasicsTab
        role={{ id: "r1", title: "A", job_description: "" }}
        isExisting={true}
        saving={false}
        onSave={onSave}
      />,
    );
    expect(screen.getByLabelText(/title/i)).toHaveValue("A");
    rerender(
      <BasicsTab
        role={{ id: "r1", title: "B", job_description: "" }}
        isExisting={true}
        saving={false}
        onSave={onSave}
      />,
    );
    expect(screen.getByLabelText(/title/i)).toHaveValue("B");
  });
});
