import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import CandidateRow from "./CandidateRow.jsx";


const base = {
  id: "c1",
  role_id: "r1",
  name: "Ada Lovelace",
  pdf_filename: "ada.pdf",
  aggregate_score: 8.5,
  rank: 1,
  status: "complete",
  error_message: null,
  scores: [],
};

const wrap = (ui) => <ul>{ui}</ul>;


describe("CandidateRow", () => {
  it("renders rank, name, filename, score, and status pill", () => {
    render(wrap(<CandidateRow candidate={base} highlighted={false} onSelect={() => {}} />));
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada.pdf")).toBeInTheDocument();
    expect(screen.getByText("8.5")).toBeInTheDocument();
    expect(screen.getByText("complete")).toBeInTheDocument();
  });

  it("renders '—' for rank when missing", () => {
    render(wrap(
      <CandidateRow candidate={{ ...base, rank: null }} highlighted={false} onSelect={() => {}} />,
    ));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("falls back to filename when name is missing", () => {
    render(wrap(
      <CandidateRow
        candidate={{ ...base, name: null }}
        highlighted={false}
        onSelect={() => {}}
      />,
    ));
    expect(screen.getAllByText("ada.pdf").length).toBeGreaterThanOrEqual(1);
  });

  it("renders inline error_message for errored rows", () => {
    render(wrap(
      <CandidateRow
        candidate={{ ...base, status: "error", error_message: "corrupt PDF" }}
        highlighted={false}
        onSelect={() => {}}
      />,
    ));
    expect(screen.getByText(/corrupt PDF/)).toBeInTheDocument();
  });

  it("calls onSelect with the candidate when clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(wrap(<CandidateRow candidate={base} highlighted={false} onSelect={onSelect} />));
    await user.click(screen.getByText("Ada Lovelace"));
    expect(onSelect).toHaveBeenCalledWith(base);
  });

  it("calls onSelect on Enter key press", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(wrap(<CandidateRow candidate={base} highlighted={false} onSelect={onSelect} />));
    const row = screen.getByText("Ada Lovelace").closest("li");
    row.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(base);
  });

  it("calls onSelect on Space key press", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(wrap(<CandidateRow candidate={base} highlighted={false} onSelect={onSelect} />));
    const row = screen.getByText("Ada Lovelace").closest("li");
    row.focus();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledWith(base);
  });

  it("applies the highlighted class when highlighted=true", () => {
    render(wrap(<CandidateRow candidate={base} highlighted={true} onSelect={() => {}} />));
    expect(screen.getByText("Ada Lovelace").closest("li").className).toContain("highlighted");
  });

  it("does not apply the highlighted class when highlighted=false", () => {
    render(wrap(<CandidateRow candidate={base} highlighted={false} onSelect={() => {}} />));
    expect(screen.getByText("Ada Lovelace").closest("li").className).not.toContain("highlighted");
  });
});
