import { useEffect, useRef, useState } from "react";
import { api } from "../services/api.js";

export default function useProgress(roleId) {
  const [batch, setBatch] = useState(null); // { total, done, active }
  const [perCandidate, setPerCandidate] = useState({}); // candidate_id → status
  const wsRef = useRef(null);

  useEffect(() => {
    if (!roleId) return;
    const ws = api.ws.progress(roleId);
    wsRef.current = ws;
    let alive = true;

    ws.onmessage = (ev) => {
      if (!alive) return;
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "batch_started") {
        setBatch({ total: msg.total || 0, done: 0, active: true });
      } else if (msg.type === "batch_complete") {
        setBatch((b) => (b ? { ...b, active: false } : { total: 0, done: 0, active: false }));
      } else if (msg.type === "progress") {
        setPerCandidate((prev) => ({
          ...prev,
          [msg.candidate_id]: {
            stage: msg.stage,
            status: msg.status,
            message: msg.message || null,
            candidate_name: msg.candidate_name || prev[msg.candidate_id]?.candidate_name || null,
          },
        }));
        if (msg.stage === "scoring" && msg.status === "complete") {
          setBatch((b) => (b ? { ...b, done: (b.done || 0) + 1 } : b));
        }
        if (msg.stage === "error") {
          setBatch((b) => (b ? { ...b, done: (b.done || 0) + 1 } : b));
        }
      }
    };

    return () => {
      alive = false;
      try {
        ws.close();
      } catch (_) {}
    };
  }, [roleId]);

  return { batch, perCandidate };
}
