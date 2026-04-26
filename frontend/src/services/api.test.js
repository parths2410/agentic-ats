import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";

beforeEach(() => {
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("api request helper", () => {
  it("sets JSON content-type when body is provided", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await api.roles.create({ title: "x" });
    const init = fetch.mock.calls[0][1];
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ title: "x" });
  });

  it("returns null on 204", async () => {
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await api.roles.delete("r")).toBeNull();
  });

  it("throws with response detail on error", async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse({ detail: "nope" }, { status: 404 })
    );
    await expect(api.roles.get("missing")).rejects.toThrow(/nope/);
  });

  it("falls back to status code when no detail returned", async () => {
    fetch.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(api.roles.list()).rejects.toThrow(/HTTP 500/);
  });

  it("uploads files via FormData", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ candidates: [] }));
    const file = new File(["x"], "a.pdf", { type: "application/pdf" });
    await api.candidates.upload("r1", [file]);
    const init = fetch.mock.calls[0][1];
    expect(init.body).toBeInstanceOf(FormData);
    // FormData is non-introspectable in jsdom — ensure the call made it.
    expect(fetch.mock.calls[0][0]).toMatch(/\/upload$/);
  });
});

describe("api method coverage", () => {
  beforeEach(() => {
    // Each call needs its own Response since the body can only be consumed once.
    fetch.mockImplementation(() => Promise.resolve(jsonResponse({})));
  });

  it("hits the right endpoints", async () => {
    await api.health();
    await api.roles.list();
    await api.roles.get("1");
    await api.roles.update("1", { title: "x" });
    await api.criteria.list("1");
    await api.criteria.create("1", { name: "c", weight: 1 });
    await api.criteria.update("1", "2", { weight: 2 });
    await api.criteria.delete("1", "2");
    await api.criteria.extract("1");
    await api.candidates.list("1");
    await api.candidates.get("1", "2");
    await api.candidates.scores("1", "2");
    await api.candidates.delete("1", "2");
    await api.scoring.rescore("1");
    await api.chat.history("1");
    await api.chat.clearHistory("1");
    const urls = fetch.mock.calls.map((c) => c[0]);
    expect(urls).toContain("/api/health");
    expect(urls).toContain("/api/roles/1/criteria/extract");
    expect(urls).toContain("/api/roles/1/chat/history");
  });
});

describe("websocket helpers", () => {
  let wsConstructions = [];

  beforeEach(() => {
    wsConstructions = [];
    class FakeWS {
      constructor(url) {
        wsConstructions.push(url);
      }
      close() {}
    }
    globalThis.WebSocket = FakeWS;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { protocol: "http:", host: "localhost:5173" },
    });
  });

  it("builds the progress URL", () => {
    api.ws.progress("r1");
    expect(wsConstructions[0]).toBe("ws://localhost:5173/ws/roles/r1/progress");
  });

  it("uses wss when on https", () => {
    window.location.protocol = "https:";
    window.location.host = "x.test";
    api.ws.chat("r1");
    expect(wsConstructions[0]).toBe("wss://x.test/ws/roles/r1/chat");
  });
});
