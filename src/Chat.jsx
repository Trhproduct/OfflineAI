import { useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001";
const HISTORY_WINDOW = 12; // keep last N messages

export default function Chat() {
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem("offlineai_chat");
    return saved
      ? JSON.parse(saved)
      : [{ role: "assistant", content: "Hi! I’m your offline AI. Ask me anything." }];
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollerRef = useRef(null);

  useEffect(() => {
    localStorage.setItem("offlineai_chat", JSON.stringify(messages));
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const user = { role: "user", content: text };
    setInput("");
    setBusy(true);

    // add user + placeholder assistant for streaming
    setMessages((m) => [...m, user, { role: "assistant", content: "" }]);

    try {
      const convo = [...messages, user]
        .slice(-HISTORY_WINDOW)
        .map(({ role, content }) => ({ role, content }));

      const r = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: convo, options: { num_predict: 256 } }),
      });

      const ct = (r.headers.get("content-type") || "").toLowerCase();

      // Non-streaming fallback (JSON)
      if (ct.includes("application/json")) {
        const data = await r.json();
        const reply = data?.response ?? "(no response)";
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: "assistant", content: reply };
          return copy;
        });
        return;
      }

      // Streaming (text/ndjson)
      if (!r.body) throw new Error("No response body");
      const reader = r.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value || new Uint8Array(), { stream: true });
        if (!chunk) continue;

        setMessages((m) => {
          const copy = m.slice();
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") last.content += chunk;
          return copy;
        });
      }
    } catch (e) {
      setMessages((m) => [
        ...m.slice(0, -1),
        { role: "assistant", content: "⚠️ Can’t reach server on 3001. Is it running?" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function clearChat() {
    setMessages([{ role: "assistant", content: "Chat cleared. How can I help?" }]);
    localStorage.removeItem("offlineai_chat");
  }

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 shadow-2xl backdrop-blur">
          {/* header */}
          <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl border border-slate-800 bg-slate-900">
                <span className="text-xs text-slate-300">AI</span>
              </div>
              <div>
                <h1 className="text-sm font-semibold tracking-wide">Murid</h1>
                <p className="text-[12px] text-slate-400">Local model • Private by default</p>
              </div>
            </div>
            <div className="flex gap-2">
              <a
                href={`${API_BASE}/health`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
              >
                Health
              </a>
              <button
                onClick={clearChat}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
              >
                Clear
              </button>
            </div>
          </div>

          {/* messages */}
          <div ref={scrollerRef} className="h-[66dvh] space-y-3 overflow-y-auto p-4 md:p-6">
            {messages.map((m, i) => (
              <Message key={i} role={m.role} content={m.content} />
            ))}
            {busy && <TypingIndicator />}
          </div>

          {/* input */}
          <div className="border-t border-slate-800/80 bg-slate-900/40 p-3 md:p-4">
            <div className="flex items-end gap-2">
              <textarea
                className="min-h-[46px] max-h-40 flex-1 resize-y rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                placeholder={busy ? "Thinking..." : "Type your message and press Enter"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={busy}
              />
              <button
                onClick={send}
                disabled={busy || input.trim().length === 0}
                className="h-[46px] shrink-0 rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Message({ role, content }) {
  const isUser = role === "user";
  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mr-2 grid h-7 w-7 place-items-center rounded-full border border-slate-800 bg-slate-900 text-[11px] text-slate-300">
          AI
        </div>
      )}
      <div
        className={`max-w-[75%] rounded-2xl border px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "border-indigo-700 bg-indigo-600 text-white"
            : "border-slate-800 bg-slate-900 text-slate-100"
        }`}
      >
        {content}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 px-1 text-[12px] text-slate-400">
      <div className="h-2 w-2 animate-pulse rounded-full bg-slate-500"></div>
      <div className="h-2 w-2 animate-pulse rounded-full bg-slate-500 [animation-delay:120ms]"></div>
      <div className="h-2 w-2 animate-pulse rounded-full bg-slate-500 [animation-delay:240ms]"></div>
      <span>AI is typing…</span>
    </div>
  );
}
