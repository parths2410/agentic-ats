import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CandidateModal from "./CandidateModal.jsx";
import { api } from "../../services/api.js";


const candidate = {
  id: "c1",
  role_id: "r1",
  name: "Anita Kapoor",
  pdf_filename: "anita.pdf",
  aggregate_score: 4.2,
  status: "complete",
  scores: [],
};

const detail = {
  ...candidate,
  raw_text: "...",
  parse_confidence: { name: "high", experience: "high", skills: "medium" },
  structured_profile: { summary: "Strong backend background." },
  scores: [
    {
      criterion_id: "k1",
      criterion_name: "Backend Development Experience",
      weight: 1.0,
      score: 5,
      rationale: "8 years at Stripe + Razorpay.",
    },
    {
      criterion_id: "k2",
      criterion_name: "PostgreSQL Expertise",
      weight: 1.0,
      score: 5,
      rationale: "Schema design and replication work.",
    },
  ],
};


beforeEach(() => {
  vi.spyOn(api.candidates, "get").mockResolvedValue(detail);
});
afterEach(() => vi.restoreAllMocks());


describe("CandidateModal", () => {
  it("renders the candidate name + filename in the header", async () => {
    render(<CandidateModal roleId="r1" candidate={candidate} onClose={() => {}} />);
    expect(screen.getByText("Anita Kapoor")).toBeInTheDocument();
    expect(screen.getByText("anita.pdf")).toBeInTheDocument();
  });

  it("renders the aggregate score banner from the summary candidate before detail loads", () => {
    render(<CandidateModal roleId="r1" candidate={candidate} onClose={() => {}} />);
    expect(screen.getByText("4.2")).toBeInTheDocument();
    expect(screen.getByText(/aggregate/)).toBeInTheDocument();
  });

  it("renders the PDF iframe pointing at the PDF endpoint", () => {
    render(<CandidateModal roleId="r1" candidate={candidate} onClose={() => {}} />);
    const frame = screen.getByTitle(/PDF for Anita Kapoor/i);
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("src")).toBe("/api/roles/r1/candidates/c1/pdf");
  });

  it("loads detail and renders the summary + parse confidence + score breakdown", async () => {
    render(<CandidateModal roleId="r1" candidate={candidate} onClose={() => {}} />);
    await screen.findByText("Strong backend background.");
    expect(screen.getByText(/name: high/)).toBeInTheDocument();
    expect(screen.getByText("Backend Development Experience")).toBeInTheDocument();
    expect(screen.getByText("8 years at Stripe + Razorpay.")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CandidateModal roleId="r1" candidate={candidate} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CandidateModal roleId="r1" candidate={candidate} onClose={onClose} />);
    await user.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  it("does NOT close when clicking inside the modal shell", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CandidateModal roleId="r1" candidate={candidate} onClose={onClose} />);
    await user.click(screen.getByText("Anita Kapoor"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CandidateModal roleId="r1" candidate={candidate} onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces a fetch error inline", async () => {
    api.candidates.get.mockRejectedValueOnce(new Error("boom"));
    render(<CandidateModal roleId="r1" candidate={candidate} onClose={() => {}} />);
    await screen.findByText(/Error loading detail: boom/);
  });

  it("falls back to the filename when name is missing", async () => {
    const onClose = vi.fn();
    api.candidates.get.mockResolvedValueOnce({
      ...detail,
      name: null,
      structured_profile: { summary: null },
    });
    render(
      <CandidateModal
        roleId="r1"
        candidate={{ ...candidate, name: null }}
        onClose={onClose}
      />,
    );
    expect(screen.getAllByText("anita.pdf").length).toBeGreaterThan(0);
  });

  it("renders '(unnamed)' if both name and filename are missing", () => {
    api.candidates.get.mockResolvedValueOnce({ ...detail, name: null, pdf_filename: null });
    render(
      <CandidateModal
        roleId="r1"
        candidate={{ ...candidate, name: null, pdf_filename: null }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("(unnamed)")).toBeInTheDocument();
  });
});
