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
  vi.spyOn(api.roles, "get").mockResolvedValue(ROLE);
  vi.spyOn(api.criteria, "list").mockResolvedValue(CRITERIA);
  vi.spyOn(api.candidates, "list").mockResolvedValue(CANDIDATES);
  vi.spyOn(api.candidates, "delete").mockResolvedValue(null);
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

  it("expands candidate detail on click", async () => {
    const user = userEvent.setup();
    renderWith();
    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: /expand/i }));
    await screen.findByText(/Ada is great/);
  });

  it("delete button calls API after confirm", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const user = userEvent.setup();
    renderWith();
    await screen.findByText("Ada");
    const deleteButtons = screen
      .getAllByRole("button", { name: "×" })
      .filter((b) => b.title === "Remove candidate");
    await user.click(deleteButtons[0]);
    await waitFor(() => expect(api.candidates.delete).toHaveBeenCalledWith("r1", "c1"));
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
});
