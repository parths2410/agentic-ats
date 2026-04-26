import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import UploadZone from "./UploadZone.jsx";
import { api } from "../../services/api.js";

beforeEach(() => {
  vi.spyOn(api.candidates, "upload").mockResolvedValue({ candidates: [{ id: "c1" }] });
});
afterEach(() => vi.restoreAllMocks());


function makeFile(name, type = "application/pdf") {
  return new File(["x"], name, { type });
}

describe("UploadZone", () => {
  it("rejects non-PDFs and shows an error", async () => {
    const { container } = render(<UploadZone roleId="r1" />);
    // Drop a non-PDF directly so the input's accept attr doesn't filter it.
    const dropzone = container.querySelector(".upload-zone");
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [makeFile("notes.txt", "text/plain")] },
    });
    await screen.findByText(/Only PDF files are accepted/);
  });

  it("stages PDFs and uploads them", async () => {
    const onUploaded = vi.fn();
    render(<UploadZone roleId="r1" onUploaded={onUploaded} />);
    const input = screen.getByRole("button", { name: /Drop PDF resumes/i }).querySelector("input");
    await userEvent.upload(input, [makeFile("a.pdf"), makeFile("b.pdf")]);

    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    expect(screen.getByText("b.pdf")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /upload 2 pdfs/i }));
    await waitFor(() => expect(api.candidates.upload).toHaveBeenCalled());
    expect(onUploaded).toHaveBeenCalledWith([{ id: "c1" }]);
  });

  it("dedupes a re-added file across separate selections", async () => {
    render(<UploadZone roleId="r1" />);
    const input = screen.getByRole("button", { name: /Drop PDF resumes/i }).querySelector("input");
    await userEvent.upload(input, makeFile("a.pdf"));
    await userEvent.upload(input, makeFile("a.pdf"));
    expect(screen.getAllByText("a.pdf")).toHaveLength(1);
  });

  it("handles upload failure gracefully", async () => {
    api.candidates.upload.mockRejectedValueOnce(new Error("LLM down"));
    render(<UploadZone roleId="r1" />);
    const input = screen.getByRole("button", { name: /Drop PDF resumes/i }).querySelector("input");
    await userEvent.upload(input, makeFile("a.pdf"));
    await userEvent.click(screen.getByRole("button", { name: /upload 1 pdf/i }));
    await screen.findByText("LLM down");
  });

  it("removes a staged file", async () => {
    render(<UploadZone roleId="r1" />);
    const input = screen.getByRole("button", { name: /Drop PDF resumes/i }).querySelector("input");
    await userEvent.upload(input, makeFile("a.pdf"));
    await userEvent.click(
      screen
        .getAllByRole("button", { name: "×" })
        .find((b) => b.title === "Remove from upload list")
    );
    expect(screen.queryByText("a.pdf")).not.toBeInTheDocument();
  });

  it("accepts drag + drop", () => {
    const { container } = render(<UploadZone roleId="r1" />);
    const dropzone = container.querySelector(".upload-zone");
    fireEvent.dragOver(dropzone);
    fireEvent.dragLeave(dropzone);
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [makeFile("dropped.pdf")] },
    });
    expect(screen.getByText("dropped.pdf")).toBeInTheDocument();
  });

  it("does not call upload with empty staged list", async () => {
    render(<UploadZone roleId="r1" />);
    // The button is disabled — clicking should not invoke upload.
    const btn = screen.getByRole("button", { name: /upload .*pdf/i });
    expect(btn).toBeDisabled();
  });
});
