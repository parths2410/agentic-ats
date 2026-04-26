import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import ResumesTab from "./ResumesTab.jsx";
import { api } from "../../services/api.js";

const wrap = (ui) => <MemoryRouter>{ui}</MemoryRouter>;

const cBase = {
  role_id: "r1",
  scores: [],
  pdf_filename: "anita.pdf",
  name: "Anita",
  status: "complete",
  aggregate_score: 4.2,
  rank: 1,
  error_message: null,
  stale_scores: false,
};

const sample = [
  { ...cBase, id: "c-old", name: "Marcus", pdf_filename: "marcus.pdf", aggregate_score: 3.5,
    created_at: "2026-04-25T12:00:00Z" },
  { ...cBase, id: "c-new", name: "Anita", pdf_filename: "anita.pdf", aggregate_score: 4.2,
    created_at: "2026-04-26T12:00:00Z" },
  { ...cBase, id: "c-err", name: null, pdf_filename: "broken.pdf", status: "error",
    aggregate_score: null, error_message: "corrupt PDF",
    created_at: "2026-04-26T11:00:00Z" },
];


beforeEach(() => {
  vi.spyOn(api.candidates, "list").mockResolvedValue([...sample]);
  vi.spyOn(api.candidates, "delete").mockResolvedValue(null);
  vi.spyOn(api.scoring, "rescore").mockResolvedValue(null);
  vi.spyOn(api.candidates, "upload").mockResolvedValue({ candidates: [] });
});
afterEach(() => vi.restoreAllMocks());


describe("ResumesTab", () => {
  it("renders the upload zone, status line, and resume rows", async () => {
    render(wrap(<ResumesTab roleId="r1" batch={null} />));
    await screen.findByText("Anita");
    expect(screen.getByText(/Drop PDF resumes here/i)).toBeInTheDocument();
    expect(screen.getByText(/2 of 3 processed/)).toBeInTheDocument();
    expect(screen.getByText(/1 error/)).toBeInTheDocument();
  });

  it("orders rows by upload time, newest first", async () => {
    render(wrap(<ResumesTab roleId="r1" batch={null} />));
    await screen.findByText("Anita");
    const names = screen.getAllByText(/^(Anita|Marcus|broken\.pdf)$/);
    expect(names[0]).toHaveTextContent("Anita");
  });

  it("shows the empty hint when there are no resumes", async () => {
    api.candidates.list.mockResolvedValueOnce([]);
    render(wrap(<ResumesTab roleId="r1" batch={null} />));
    await screen.findByText(/upload pdfs above to get started/i);
  });

  it("falls back to the filename when the candidate has no parsed name", async () => {
    render(wrap(<ResumesTab roleId="r1" batch={null} />));
    await screen.findByText("broken.pdf");
  });

  it("renders an inline error message for errored rows", async () => {
    render(wrap(<ResumesTab roleId="r1" batch={null} />));
    await screen.findByText(/corrupt PDF/);
  });

  it("invokes onSelect when a row is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(wrap(<ResumesTab roleId="r1" batch={null} onSelect={onSelect} />));
    await user.click(await screen.findByText("Anita"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "c-new" }));
  });

  it("invokes onSelect on Enter key press", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(wrap(<ResumesTab roleId="r1" batch={null} onSelect={onSelect} />));
    await screen.findByText("Anita");
    const row = screen.getByText("Anita").closest("li");
    row.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "c-new" }));
  });

  it("delete icon confirms then deletes and removes the row", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const user = userEvent.setup();
    render(wrap(<ResumesTab roleId="r1" batch={null} />));
    await screen.findByText("Anita");
    await user.click(screen.getByRole("button", { name: /delete anita/i }));
    await waitFor(() => expect(api.candidates.delete).toHaveBeenCalledWith("r1", "c-new"));
    await waitFor(() => expect(screen.queryByText("Anita")).not.toBeInTheDocument());
  });

  it("delete is skipped when the user cancels confirm", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    const user = userEvent.setup();
    render(wrap(<ResumesTab roleId="r1" batch={null} />));
    await screen.findByText("Anita");
    await user.click(screen.getByRole("button", { name: /delete anita/i }));
    expect(api.candidates.delete).not.toHaveBeenCalled();
  });

  it("delete icon click does NOT trigger row's onSelect", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(wrap(<ResumesTab roleId="r1" batch={null} onSelect={onSelect} />));
    await screen.findByText("Anita");
    await user.click(screen.getByRole("button", { name: /delete anita/i }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Re-score all calls scoring.rescore and notifies onStatus", async () => {
    const onStatus = vi.fn();
    const user = userEvent.setup();
    render(wrap(<ResumesTab roleId="r1" batch={null} onStatus={onStatus} />));
    await screen.findByText("Anita");
    await user.click(screen.getByRole("button", { name: /re-score all/i }));
    await waitFor(() => expect(api.scoring.rescore).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith("Re-scoring started."));
  });

  it("renders 'View full ranking' link to the workspace", async () => {
    render(wrap(<ResumesTab roleId="r1" batch={null} />));
    await screen.findByText("Anita");
    expect(screen.getByRole("link", { name: /view full ranking/i })).toHaveAttribute(
      "href",
      "/roles/r1/workspace",
    );
  });

  it("surfaces fetch errors via onError", async () => {
    const onError = vi.fn();
    api.candidates.list.mockRejectedValueOnce(new Error("nope"));
    render(wrap(<ResumesTab roleId="r1" batch={null} onError={onError} />));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("nope"));
  });

  it("refetches candidates when the batch progresses", async () => {
    const { rerender } = render(
      wrap(<ResumesTab roleId="r1" batch={{ active: true, total: 3, done: 0 }} />),
    );
    await screen.findByText("Anita");
    api.candidates.list.mockClear();
    rerender(
      wrap(<ResumesTab roleId="r1" batch={{ active: true, total: 3, done: 1 }} />),
    );
    await waitFor(() => expect(api.candidates.list).toHaveBeenCalledWith("r1"));
  });
});
