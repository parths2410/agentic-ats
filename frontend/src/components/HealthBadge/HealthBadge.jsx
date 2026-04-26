import { useEffect, useState } from "react";
import { api } from "../../services/api.js";

export default function HealthBadge() {
  const [status, setStatus] = useState({ state: "loading", text: "checking..." });

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((data) => {
        if (!cancelled) setStatus({ state: "ok", text: `backend: ${data.status}` });
      })
      .catch((err) => {
        if (!cancelled) setStatus({ state: "error", text: `backend: ${err.message}` });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <span className={`health-status ${status.state}`}>{status.text}</span>;
}
