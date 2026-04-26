import { useEffect, useRef, useState } from "react";
import useChat from "../../hooks/useChat.js";

export default function ChatPanel({ roleId }) {
  const { messages, toolStatus, pending, error, historyLoading, send, clear } =
    useChat(roleId);
  const [input, setInput] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, toolStatus]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim() || pending) return;
    send(input);
    setInput("");
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <aside className="chat-panel">
      <header className="chat-header">
        <h3>Assistant</h3>
        <button
          type="button"
          onClick={clear}
          className="btn btn-secondary btn-sm"
          disabled={messages.length === 0 || pending}
          title="Clear chat history"
        >
          Clear
        </button>
      </header>

      <div className="chat-history" ref={scrollRef} aria-live="polite">
        {historyLoading && <p className="hint">Loading history…</p>}
        {!historyLoading && messages.length === 0 && (
          <p className="hint">
            Ask about the candidates — e.g. "Who has the strongest Python
            background?" or "What percentage have CS degrees?"
          </p>
        )}
        {messages.map((m, i) => (
          <div key={m.id || i} className={`chat-msg chat-msg-${m.role}`}>
            <div className="chat-msg-role">{m.role === "user" ? "You" : "Assistant"}</div>
            <div className="chat-msg-content">{m.content || "(empty)"}</div>
            {m.truncated && (
              <div className="hint">
                (assistant ran out of iterations before finishing)
              </div>
            )}
          </div>
        ))}
        {toolStatus && (
          <div className="chat-tool-status">
            <span className="dot" /> {toolStatus.summary || `${toolStatus.tool_name} (${toolStatus.status})`}
          </div>
        )}
        {pending && !toolStatus && (
          <div className="chat-tool-status">
            <span className="dot" /> Thinking…
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      <form className="chat-input-row" onSubmit={handleSubmit}>
        <textarea
          rows={2}
          placeholder="Ask the assistant…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={pending}
        />
        <button type="submit" className="btn" disabled={pending || !input.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}
