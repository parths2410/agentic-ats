import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api.js";

/**
 * Manage the chat panel for a role:
 * - Loads persisted history via REST on mount.
 * - Owns a single WebSocket to /ws/roles/:id/chat.
 * - Tracks tool_status events, the live "thinking" assistant message, and
 *   the final chat_complete payload.
 *
 * The hook is intentionally framework-light — pure setState updates. The
 * UI consumes `messages`, `toolStatus`, `pending`, and `error`.
 *
 * `messages` shape: [{ role: "user"|"assistant", content, ui_mutations?, tool_trace? }, ...]
 */
export default function useChat(roleId) {
  const [messages, setMessages] = useState([]);
  const [toolStatus, setToolStatus] = useState(null); // { tool_name, status, summary }
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const wsRef = useRef(null);
  const readyRef = useRef(false);

  // ---- Initial history fetch -----------------------------------------
  useEffect(() => {
    if (!roleId) return;
    let cancelled = false;
    setHistoryLoading(true);
    api.chat
      .history(roleId)
      .then((res) => {
        if (cancelled) return;
        const msgs = (res?.messages || []).map((m) => ({
          role: m.role_enum,
          content: m.content,
          ui_mutations: m.ui_mutations,
          id: m.id,
        }));
        setMessages(msgs);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roleId]);

  // ---- WebSocket lifecycle -------------------------------------------
  useEffect(() => {
    if (!roleId) return undefined;
    const ws = api.ws.chat(roleId);
    wsRef.current = ws;
    readyRef.current = false;

    ws.onmessage = (evt) => {
      let data;
      try {
        data = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (data.type === "ready") {
        readyRef.current = true;
        return;
      }
      if (data.type === "tool_status") {
        setToolStatus({
          tool_name: data.tool_name,
          status: data.status,
          summary: data.summary,
        });
        return;
      }
      if (data.type === "chat_complete") {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.content,
            ui_mutations: data.ui_mutations,
            truncated: data.truncated,
          },
        ]);
        setToolStatus(null);
        setPending(false);
        return;
      }
      if (data.type === "error") {
        setError(data.message || "Chat error");
        setToolStatus(null);
        setPending(false);
        return;
      }
    };

    ws.onerror = () => setError("Chat connection error");
    ws.onclose = () => {
      readyRef.current = false;
    };

    return () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }, [roleId]);

  // ---- Send a user message -------------------------------------------
  const send = useCallback((content) => {
    const text = (content || "").trim();
    if (!text) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError("Chat is still connecting — try again in a moment.");
      return;
    }
    setError(null);
    setPending(true);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    ws.send(JSON.stringify({ type: "chat_message", content: text }));
  }, []);

  // ---- Clear history --------------------------------------------------
  const clear = useCallback(async () => {
    if (!roleId) return;
    try {
      await api.chat.clearHistory(roleId);
      setMessages([]);
      setToolStatus(null);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [roleId]);

  return {
    messages,
    toolStatus,
    pending,
    error,
    historyLoading,
    send,
    clear,
  };
}
