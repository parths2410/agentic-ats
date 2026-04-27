import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import Workspace from "./Workspace.jsx";
import { api } from "../../services/api.js";

class FakeWS {
  close() {}
}

const ROLE = { id: "r1", title: "Backend Eng", job_description: "JD" };
const CRITERIA = [
  { id: "cr1", role_id: "r1", name: "Python", description: "py", weight: 1.0, source: "auto", order_index: 1 },
];
const CANDIDATES = [
  {
    id: "c1",
    role_id: "r1",
    name: "Ada",
    pdf_filename: "ada.pdf",
    aggregate_score: 8.5,
    rank: 1,
    status: "complete",
    error_message: null,
    created_at: new Date().toISOString(),
    scores: [
      { criterion_id: "cr1", criterion_name: "Python", weight: 1.0, score: 9.0, rationale: "good" },
    ],
  },
  {
    id: "c2",
    role_id: "r1",
    name: null,
    pdf_filename: "x.pdf",
    aggregate_score: null,
    rank: null,
    status: "pending",
    error_message: null,
    created_at: new Date().toISOString(),
    scores: [],
  },
];

beforeEach(() => {
  vi.spyOn(api.ws, "progress").mockImplementation(() => new FakeWS());
  vi.spyOn(api.ws, "chat").mockImplementation(() => new FakeWS());
  vi.spyOn(api.chat, "history").mockResolvedValue({ messages: [] });
  vi.spyOn(api.chat, "uiState").mockResolvedValue({
    role_id: "r1",
    highlighted_candidate_ids: [],
    current_sort_field: null,
    current_sort_order: null,
  });
  vi.spyOn(api.chat, "reset").mockResolvedValue({
    role_id: "r1",
    highlighted_candidate_ids: [],
    current_sort_field: null,
    current_sort_order: null,
  });
  vi.spyOn(api.roles, "get").mockResolvedValue(ROLE);
  vi.spyOn(api.criteria, "list").mockResolvedValue(CRITERIA);
  vi.spyOn(api.candidates, "list").mockResolvedValue(CANDIDATES);
  vi.spyOn(api.candidates, "get").mockResolvedValue({
    ...CANDIDATES[0],
    raw_text: "...",
    structured_profile: { summary: "Ada is great", experiences: [], education: [], skills: ["Python"] },
    parse_confidence: null,
  });
  vi.spyOn(api.scoring, "rescore").mockResolvedValue({ status: "rescore_started" });
});
afterEach(() => vi.restoreAllMocks());


function renderWith() {
  return render(
    <MemoryRouter initialEntries={["/roles/r1/workspace"]}>
      <Routes>
        <Route path="/roles/:roleId/workspace" element={<Workspace />} />
      </Routes>
    </MemoryRouter>
  );
}


describe("Workspace", () => {
  it("renders header, candidate list, and chat panel", async () => {
    renderWith();
    await screen.findByText("Backend Eng");
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText(/Assistant/i)).toBeInTheDocument();
  });

  it("renders the rank, aggregate score, and status pill on each row", async () => {
    renderWith();
    await screen.findByText("Ada");
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("8.5")).toBeInTheDocument();
    expect(screen.getByText("complete")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("clicking a row opens the candidate modal", async () => {
    const user = userEvent.setup();
    renderWith();
    await screen.findByText("Ada");
    await user.click(screen.getByText("Ada"));
    await waitFor(() => expect(api.candidates.get).toHaveBeenCalledWith("r1", "c1"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Escape closes the candidate modal", async () => {
    const user = userEvent.setup();
    renderWith();
    await screen.findByText("Ada");
    await user.click(screen.getByText("Ada"));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("highlighted rows get the highlighted CSS class", async () => {
    api.chat.uiState.mockResolvedValueOnce({
      role_id: "r1",
      highlighted_candidate_ids: ["c1"],
      current_sort_field: null,
      current_sort_order: null,
    });
    renderWith();
    await screen.findByText("Ada");
    const row = screen.getByText("Ada").closest("li");
    expect(row.className).toContain("highlighted");
  });

  it("Re-score all triggers the scoring API", async () => {
    const user = userEvent.setup();
    renderWith();
    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: /re-score all/i }));
    await waitFor(() => expect(api.scoring.rescore).toHaveBeenCalledWith("r1"));
  });

  it("shows error state when load fails", async () => {
    api.roles.get.mockRejectedValueOnce(new Error("down"));
    api.criteria.list.mockRejectedValueOnce(new Error("down"));
    api.candidates.list.mockRejectedValueOnce(new Error("down"));
    renderWith();
    await screen.findByText(/down/);
  });

  it("seeds highlights and sort from initial UI state", async () => {
    api.chat.uiState.mockResolvedValueOnce({
      role_id: "r1",
      highlighted_candidate_ids: ["c1"],
      current_sort_field: "Python",
      current_sort_order: "asc",
    });
    renderWith();
    await screen.findByText("Ada");
    expect(screen.getByText(/highlighted/i)).toBeInTheDocument();
    expect(screen.getByText(/sorted by/i)).toBeInTheDocument();
  });

  it("inline Reset link calls the reset endpoint", async () => {
    api.chat.uiState.mockResolvedValueOnce({
      role_id: "r1",
      highlighted_candidate_ids: ["c1"],
      current_sort_field: null,
      current_sort_order: null,
    });
    const user = userEvent.setup();
    renderWith();
    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: /^reset$/i }));
    await waitFor(() => expect(api.chat.reset).toHaveBeenCalledWith("r1"));
  });

  it("does not show the Reset link when no highlights or sort", async () => {
    renderWith();
    await screen.findByText("Ada");
    expect(screen.queryByRole("button", { name: /^reset$/i })).not.toBeInTheDocument();
  });

  it("renders the Setup → link pointing at the role setup page", async () => {
    renderWith();
    await screen.findByText("Backend Eng");
    expect(screen.getByRole("link", { name: /setup →/i })).toHaveAttribute("href", "/roles/r1");
  });

  it("does not render the old Edit role / criteria button", async () => {
    renderWith();
    await screen.findByText("Backend Eng");
    expect(screen.queryByRole("link", { name: /edit role/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit role/i })).not.toBeInTheDocument();
  });

  it("shows stale-scores banner when any candidate is stale", async () => {
    api.candidates.list.mockResolvedValueOnce(
      CANDIDATES.map((c) => ({ ...c, stale_scores: true }))
    );
    renderWith();
    await screen.findByText(/Scores are out of date/i);
  });

  it("Re-score now from banner triggers rescore", async () => {
    api.candidates.list.mockResolvedValueOnce(
      CANDIDATES.map((c) => ({ ...c, stale_scores: true }))
    );
    const user = userEvent.setup();
    renderWith();
    await screen.findByText(/Scores are out of date/i);
    await user.click(screen.getByRole("button", { name: /re-score now/i }));
    await waitFor(() => expect(api.scoring.rescore).toHaveBeenCalledWith("r1"));
  });

  it("falls back to filename when candidate has no parsed name", async () => {
    renderWith();
    const matches = await screen.findAllByText("x.pdf");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("empty state hero links to the Resumes tab on RoleSetup", async () => {
    api.candidates.list.mockResolvedValueOnce([]);
    renderWith();
    await screen.findByText("No candidates yet");
    expect(screen.getByRole("link", { name: /upload resumes/i })).toHaveAttribute(
      "href",
      "/roles/r1?tab=resumes",
    );
  });
});
