// Server/server.js
// Streaming proxy from your UI -> Ollama with keep-alive + warmup.

const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const dotenv = require("dotenv");
const http = require("http");
const https = require("https");

// Load the ROOT .env, not Server/.env
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: true }));
app.use(morgan("dev"));

const PORT = Number(process.env.PORT || 3001);
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const CHAT_MODEL = process.env.CHAT_MODEL || "llama3.2:3b-instruct-q4_K_M";

// Reuse TCP connections (lower handshake latency)
const keepAliveHttpAgent = new http.Agent({ keepAlive: true });
const keepAliveHttpsAgent = new https.Agent({ keepAlive: true });
function agentFor(url) {
  return url.startsWith("https") ? keepAliveHttpsAgent : keepAliveHttpAgent;
}

app.get("/health", (req, res) => {
  res.json({ ok: true, server: "offline-ai", model: CHAT_MODEL, ollama: OLLAMA_URL });
});

// --- Streamed chat proxy (handles /api/chat and /api/generate shapes)
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, prompt, model, options } = req.body || {};
    const modelName = String(model || CHAT_MODEL);

    const genOpts = {
      // speed knobs
      num_ctx: 2048,
      num_predict: 256,
      keep_alive: "4h",
      ...options,
    };

    let endpoint, payload;
    if (Array.isArray(messages) && messages.length) {
      endpoint = "/api/chat";
      payload = { model: modelName, messages, stream: true, options: genOpts };
    } else {
      endpoint = "/api/generate";
      payload = { model: modelName, prompt: String(prompt || ""), stream: true, options: genOpts };
    }

    const r = await fetch(`${OLLAMA_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      agent: agentFor(OLLAMA_URL),
    });

    if (!r.ok || !r.body) {
      const detail = await r.text().catch(() => "");
      return res.status(502).json({ error: "ollama_error", detail });
    }

    // Stream to client
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    const reader = r.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let wroteSomething = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);

          // /api/generate → { response: "..." }
          if (typeof obj.response === "string" && obj.response.length) {
            res.write(obj.response);
            wroteSomething = true;
          }

          // /api/chat → { message: { content: "..." } }
          const chatChunk = obj?.message?.content;
          if (typeof chatChunk === "string" && chatChunk.length) {
            res.write(chatChunk);
            wroteSomething = true;
          }

          if (obj.error && !wroteSomething) {
            res.write(String(obj.error));
            wroteSomething = true;
          }
        } catch {
          // non-JSON line, just forward
          res.write(line);
          wroteSomething = true;
        }
      }
    }

    // flush remaining partial
    if (buffer.trim()) {
      try {
        const obj = JSON.parse(buffer);
        if (obj.response) { res.write(obj.response); wroteSomething = true; }
        const chatChunk = obj?.message?.content;
        if (chatChunk) { res.write(chatChunk); wroteSomething = true; }
      } catch {
        res.write(buffer);
        wroteSomething = true;
      }
    }

    if (!wroteSomething) res.write(""); // ensure at least one chunk
    res.end();
  } catch (err) {
    console.error("SERVER ERROR:", err);
    res.status(500).json({ error: "server_error", detail: String(err) });
  }
});

// Optional: quick echo for UI test without Ollama
app.post("/api/echo", (req, res) => {
  const { prompt = "", messages = [] } = req.body || {};
  const last = messages[messages.length - 1]?.content ?? prompt;
  res.json({ response: `echo: ${last}` });
});

// Warm the model on boot (tiny prompt)
async function warmUp() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CHAT_MODEL,
        prompt: "ok",
        stream: false,
        options: { keep_alive: "4h", num_predict: 1 },
      }),
      agent: agentFor(OLLAMA_URL),
    });
    await r.text();
    console.log("🔥 Warmed model", CHAT_MODEL);
  } catch (e) {
    console.warn("Warmup failed (will still serve):", e.message);
  }
}

app.listen(PORT, () => {
  console.log(`✅ API up on http://localhost:${PORT}`);
  console.log(`➡️  Forwarding to Ollama at ${OLLAMA_URL}`);
  console.log(`🧠 Default model: ${CHAT_MODEL}`);
  warmUp();
});
