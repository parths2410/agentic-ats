import { useEffect, useRef, useState } from "react";

function readStored(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return n;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* quota / disabled — ignore */
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

export default function Splitter({
  storageKey,
  defaultFraction = 0.4,
  min = 0.25,
  max = 0.75,
  left,
  right,
}) {
  const containerRef = useRef(null);
  const [fraction, setFraction] = useState(() =>
    clamp(readStored(storageKey, defaultFraction), min, max),
  );
  const fractionRef = useRef(fraction);
  fractionRef.current = fraction;
  const [dragging, setDragging] = useState(false);

  function handleMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragging(true);
  }

  function handleDoubleClick() {
    setFraction(defaultFraction);
    writeStored(storageKey, defaultFraction);
  }

  useEffect(() => {
    if (!dragging) return;
    function onMove(e) {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const next = round2(clamp((e.clientX - rect.left) / rect.width, min, max));
      setFraction(next);
    }
    function onUp() {
      setDragging(false);
      writeStored(storageKey, fractionRef.current);
    }
    function preventSelect(e) {
      e.preventDefault();
    }
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("selectstart", preventSelect);
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("selectstart", preventSelect);
    };
  }, [dragging, min, max, storageKey]);

  const leftPct = `${(fraction * 100).toFixed(2)}%`;
  const rightPct = `${((1 - fraction) * 100).toFixed(2)}%`;

  return (
    <div
      ref={containerRef}
      className={`splitter${dragging ? " dragging" : ""}`}
      style={{ gridTemplateColumns: `${leftPct} 8px ${rightPct}` }}
    >
      <div className="splitter-pane splitter-left">{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={Math.round(min * 100)}
        aria-valuemax={Math.round(max * 100)}
        aria-label="Resize panes"
        tabIndex={0}
        className="splitter-handle"
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            const next = round2(clamp(fraction - 0.02, min, max));
            setFraction(next);
            writeStored(storageKey, next);
          } else if (e.key === "ArrowRight") {
            const next = round2(clamp(fraction + 0.02, min, max));
            setFraction(next);
            writeStored(storageKey, next);
          }
        }}
      />
      <div className="splitter-pane splitter-right">{right}</div>
    </div>
  );
}
