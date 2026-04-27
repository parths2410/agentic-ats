import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import useChat from "../../hooks/useChat.js";

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

export default function ChatPanel({ roleId, onMutations }) {
  const { messages, toolStatus, pending, error, historyLoading, send, clear } =
    useChat(roleId, { onMutations });
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

  function handleClear() {
    if (messages.length === 0 || pending) return;
    if (!confirm("Clear chat history? This can't be undone.")) return;
    clear();
  }

  return (
    <aside className="chat-panel">
      <header className="chat-header">
        <h3>Assistant</h3>
        <button
          type="button"
          onClick={handleClear}
          className="chat-clear-btn"
          disabled={messages.length === 0 || pending}
          title="Clear chat history"
        >
          Clear
        </button>
      </header>

      <div className="chat-history" ref={scrollRef} aria-live="polite">
        {historyLoading && <p className="chat-loading">Loading history…</p>}
        {!historyLoading && messages.length === 0 && (
          <div className="chat-empty">
            <p className="chat-empty-title">Ask about the candidates</p>
            <ul className="chat-empty-examples">
              <li>"Who has the strongest Python background?"</li>
              <li>"What percentage have CS degrees?"</li>
              <li>"Highlight everyone with PostgreSQL experience."</li>
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={m.id || i} className={`chat-msg chat-msg-${m.role}`}>
            <div className="chat-msg-role">{m.role === "user" ? "YOU" : "ASSISTANT"}</div>
            <div className="chat-msg-content">
              {m.role === "assistant" ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {m.content || "(empty)"}
                </ReactMarkdown>
              ) : (
                m.content || "(empty)"
              )}
            </div>
            {m.truncated && (
              <div className="chat-msg-truncated">
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
          rows={3}
          placeholder="Ask the assistant…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={pending}
        />
        <button
          type="submit"
          className="chat-send-btn"
          disabled={pending || !input.trim()}
          aria-label="Send"
          title="Send (Enter)"
        >
          <SendIcon />
        </button>
      </form>
    </aside>
  );
}
