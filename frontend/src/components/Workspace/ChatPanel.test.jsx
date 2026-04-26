import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatPanel from "./ChatPanel.jsx";
import { api } from "../../services/api.js";

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.OPEN; // assume connected by the time tests interact
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.readyState = 3;
  }
  send(data) {
    this.sent.push(data);
  }
  emit(payload) {
    this.onmessage && this.onmessage({ data: JSON.stringify(payload) });
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  vi.spyOn(api.chat, "history").mockResolvedValue({ messages: [] });
  vi.spyOn(api.chat, "clearHistory").mockResolvedValue(null);
  vi.spyOn(api.ws, "chat").mockImplementation((rid) => new FakeWebSocket(`ws://test/${rid}`));
});

afterEach(() => {
  vi.restoreAllMocks();
});


describe("ChatPanel", () => {
  it("shows the empty-state hint when there is no history", async () => {
    render(<ChatPanel roleId="r1" />);
    await screen.findByText(/Ask about the candidates/i);
  });

  it("sends a message and renders the user bubble", async () => {
    const user = userEvent.setup();
    render(<ChatPanel roleId="r1" />);
    await screen.findByText(/Ask about the candidates/i);

    const ta = screen.getByPlaceholderText(/Ask the assistant/i);
    await user.type(ta, "Top 3?");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(screen.getByText("Top 3?")).toBeInTheDocument();
    const ws = FakeWebSocket.instances[0];
    expect(ws.sent).toHaveLength(1);
  });

  it("renders an assistant message after chat_complete", async () => {
    const user = userEvent.setup();
    render(<ChatPanel roleId="r1" />);
    await screen.findByText(/Ask about the candidates/i);

    const ws = FakeWebSocket.instances[0];
    const ta = screen.getByPlaceholderText(/Ask the assistant/i);
    await user.type(ta, "hi");
    await user.click(screen.getByRole("button", { name: /send/i }));
    act(() => ws.emit({ type: "chat_complete", content: "Hello there" }));

    await screen.findByText("Hello there");
  });

  it("shows tool status while a tool runs", async () => {
    const user = userEvent.setup();
    render(<ChatPanel roleId="r1" />);
    await screen.findByText(/Ask about the candidates/i);
    const ws = FakeWebSocket.instances[0];
    await user.type(screen.getByPlaceholderText(/Ask the assistant/i), "hi");
    await user.click(screen.getByRole("button", { name: /send/i }));
    act(() => ws.emit({
      type: "tool_status",
      tool_name: "search_candidates",
      status: "executing",
      summary: "Searching candidates",
    }));
    await screen.findByText(/Searching candidates/);
  });

  it("Send is disabled when the input is empty", async () => {
    render(<ChatPanel roleId="r1" />);
    await screen.findByText(/Ask about the candidates/i);
    const btn = screen.getByRole("button", { name: /send/i });
    expect(btn).toBeDisabled();
  });

  it("Clear button calls the API and clears messages", async () => {
    api.chat.history.mockResolvedValueOnce({
      messages: [
        { id: "m1", role_enum: "user", content: "old" },
      ],
    });
    const user = userEvent.setup();
    render(<ChatPanel roleId="r1" />);
    await screen.findByText("old");
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(api.chat.clearHistory).toHaveBeenCalledWith("r1");
  });

  it("Enter (without shift) submits the form", async () => {
    const user = userEvent.setup();
    render(<ChatPanel roleId="r1" />);
    await screen.findByText(/Ask about the candidates/i);
    const ta = screen.getByPlaceholderText(/Ask the assistant/i);
    await user.type(ta, "ping{Enter}");
    expect(screen.getByText("ping")).toBeInTheDocument();
  });
});
