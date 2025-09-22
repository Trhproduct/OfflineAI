// Server/server.js
// Why this file exists:
// - Your React UI should call THIS server (e.g., http://localhost:3001/api/chat)
// - This server forwards the request to local Ollama (http://localhost:11434)
// - Central place to change model/URL, add logging/CORS, and later memory/DB

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: true }));
app.use(morgan("dev"));

const PORT = Number(process.env.PORT || 3001);
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const CHAT_MODEL = process.env.CHAT_MODEL || "llama3.1";

// ---- Routes ----

// Health check: quick sanity endpoint
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    server: "offline-ai",
    model: CHAT_MODEL,
    ollama: OLLAMA_URL
  });
});

// Chat proxy (non-streaming):
// Accepts either { messages: [{role, content}, ...] } or { prompt: "..." }
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, prompt, model } = req.body || {};
    const modelName = String(model || CHAT_MODEL);

    // If UI sent a chat history, hit /api/chat
    if (Array.isArray(messages) && messages.length) {
      const payload = { model: modelName, messages, stream: false };
      const r = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        return res.status(502).json({ error: "ollama_error", detail });
      }
      const data = await r.json();
      const content = data?.message?.content ?? "";
      return res.json({ response: content, model: modelName });
    }

    // Otherwise treat it as a single-prompt generate
    const payload = { model: modelName, prompt: String(prompt || ""), stream: false };
    const r = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(502).json({ error: "ollama_error", detail });
    }
    const data = await r.json();
    return res.json({ response: data?.response ?? "", model: modelName });
  } catch (err) {
    console.error("SERVER ERROR:", err);
    res.status(500).json({ error: "server_error", detail: String(err) });
  }
});

// Optional: quick echo to test UI without Ollama
app.post("/api/echo", (req, res) => {
  const { prompt = "", messages = [] } = req.body || {};
  const last = messages[messages.length - 1]?.content ?? prompt;
  res.json({ response: `echo: ${last}` });
});

app.listen(PORT, () => {
  console.log(`✅ API up on http://localhost:${PORT}`);
  console.log(`➡️  Forwarding to Ollama at ${OLLAMA_URL}`);
  console.log(`🧠 Default model: ${CHAT_MODEL}`);
});
