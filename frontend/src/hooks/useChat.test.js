import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import useChat from "./useChat.js";
import { api } from "../services/api.js";

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.readyState = 3;
    this.onclose && this.onclose();
  }
  send(data) {
    this.sent.push(data);
  }
  // helpers used by tests
  fakeOpen() {
    this.readyState = FakeWebSocket.OPEN;
  }
  emit(payload) {
    this.onmessage && this.onmessage({ data: JSON.stringify(payload) });
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  vi.spyOn(api.chat, "history").mockResolvedValue({
    messages: [
      { id: "1", role_enum: "user", content: "old?" },
      { id: "2", role_enum: "assistant", content: "old answer" },
    ],
  });
  vi.spyOn(api.chat, "clearHistory").mockResolvedValue(null);
  vi.spyOn(api.ws, "chat").mockImplementation((rid) => new FakeWebSocket(`ws://test/${rid}`));
});

afterEach(() => {
  vi.restoreAllMocks();
});


describe("useChat", () => {
  it("loads history and exposes messages", async () => {
    const { result } = renderHook(() => useChat("r1"));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].role).toBe("user");
  });

  it("send appends a user message and emits over the WS", async () => {
    const { result } = renderHook(() => useChat("r1"));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));

    const ws = FakeWebSocket.instances[0];
    ws.fakeOpen();
    act(() => result.current.send("Hello"));
    expect(result.current.pending).toBe(true);
    expect(result.current.messages.at(-1)).toMatchObject({ role: "user", content: "Hello" });
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "chat_message", content: "Hello" });
  });

  it("ignores empty input on send", async () => {
    const { result } = renderHook(() => useChat("r1"));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));
    const ws = FakeWebSocket.instances[0];
    ws.fakeOpen();
    act(() => result.current.send("   "));
    expect(result.current.pending).toBe(false);
    expect(ws.sent).toHaveLength(0);
  });

  it("queues an error if the socket isn't open yet", async () => {
    const { result } = renderHook(() => useChat("r1"));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));
    act(() => result.current.send("hi"));
    expect(result.current.error).toMatch(/connecting/);
  });

  it("processes tool_status events", async () => {
    const { result } = renderHook(() => useChat("r1"));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));
    const ws = FakeWebSocket.instances[0];
    ws.fakeOpen();
    act(() => {
      ws.emit({ type: "ready" });
      ws.emit({
        type: "tool_status",
        tool_name: "search_candidates",
        status: "executing",
        summary: "Searching",
      });
    });
    expect(result.current.toolStatus.tool_name).toBe("search_candidates");
  });

  it("processes chat_complete and clears pending", async () => {
    const { result } = renderHook(() => useChat("r1"));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));
    const ws = FakeWebSocket.instances[0];
    ws.fakeOpen();
    act(() => result.current.send("hi"));
    act(() => ws.emit({ type: "chat_complete", content: "done!" }));
    expect(result.current.pending).toBe(false);
    expect(result.current.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "done!",
    });
  });

  it("processes error events", async () => {
    const { result } = renderHook(() => useChat("r1"));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));
    const ws = FakeWebSocket.instances[0];
    ws.fakeOpen();
    act(() => result.current.send("hi"));
    act(() => ws.emit({ type: "error", message: "LLM unavailable" }));
    expect(result.current.error).toBe("LLM unavailable");
    expect(result.current.pending).toBe(false);
  });

  it("clear() empties messages and calls API", async () => {
    const { result } = renderHook(() => useChat("r1"));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));
    await act(() => result.current.clear());
    expect(result.current.messages).toEqual([]);
    expect(api.chat.clearHistory).toHaveBeenCalledWith("r1");
  });

  it("ignores malformed WS payloads", async () => {
    const { result } = renderHook(() => useChat("r1"));
    await waitFor(() => expect(result.current.historyLoading).toBe(false));
    const ws = FakeWebSocket.instances[0];
    ws.fakeOpen();
    act(() => ws.onmessage({ data: "not-json" }));
    // No crash, no state change.
    expect(result.current.error).toBeNull();
  });

  it("surfaces history fetch errors", async () => {
    api.chat.history.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useChat("r1"));
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });

  it("returns gracefully without a roleId", () => {
    const { result } = renderHook(() => useChat(null));
    expect(result.current.messages).toEqual([]);
  });
});
