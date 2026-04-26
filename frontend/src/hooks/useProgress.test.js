import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import useProgress from "./useProgress.js";
import { api } from "../services/api.js";

class FakeWS {
  constructor(url) {
    this.url = url;
  }
  close() {}
  emit(payload) {
    this.onmessage && this.onmessage({ data: JSON.stringify(payload) });
  }
  emitRaw(s) {
    this.onmessage && this.onmessage({ data: s });
  }
}

let wsInstance;

beforeEach(() => {
  vi.spyOn(api.ws, "progress").mockImplementation((rid) => {
    wsInstance = new FakeWS(`ws://x/${rid}`);
    return wsInstance;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});


describe("useProgress", () => {
  it("starts with null batch and empty perCandidate", () => {
    const { result } = renderHook(() => useProgress("r1"));
    expect(result.current.batch).toBeNull();
    expect(result.current.perCandidate).toEqual({});
  });

  it("returns inert state when roleId is missing", () => {
    const { result } = renderHook(() => useProgress(null));
    expect(result.current.batch).toBeNull();
  });

  it("handles batch_started + batch_complete", () => {
    const { result } = renderHook(() => useProgress("r1"));
    act(() => wsInstance.emit({ type: "batch_started", total: 3 }));
    expect(result.current.batch).toEqual({ total: 3, done: 0, active: true });
    act(() => wsInstance.emit({ type: "batch_complete" }));
    expect(result.current.batch.active).toBe(false);
  });

  it("increments done on scoring complete and on errors", () => {
    const { result } = renderHook(() => useProgress("r1"));
    act(() => wsInstance.emit({ type: "batch_started", total: 2 }));
    act(() =>
      wsInstance.emit({
        type: "progress",
        candidate_id: "c1",
        stage: "scoring",
        status: "complete",
        candidate_name: "Ada",
      })
    );
    expect(result.current.batch.done).toBe(1);
    act(() =>
      wsInstance.emit({
        type: "progress",
        candidate_id: "c2",
        stage: "error",
        status: "error",
      })
    );
    expect(result.current.batch.done).toBe(2);
  });

  it("ignores malformed payloads", () => {
    const { result } = renderHook(() => useProgress("r1"));
    act(() => wsInstance.emitRaw("not-json"));
    expect(result.current.batch).toBeNull();
  });

  it("populates perCandidate", () => {
    const { result } = renderHook(() => useProgress("r1"));
    act(() =>
      wsInstance.emit({
        type: "progress",
        candidate_id: "c1",
        stage: "parsing",
        status: "in_progress",
      })
    );
    expect(result.current.perCandidate.c1.stage).toBe("parsing");
  });

  it("batch_complete with no prior batch produces a default zero state", () => {
    const { result } = renderHook(() => useProgress("r1"));
    act(() => wsInstance.emit({ type: "batch_complete" }));
    expect(result.current.batch).toEqual({ total: 0, done: 0, active: false });
  });
});
