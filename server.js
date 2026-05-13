import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import path from "path";
import { readFileSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Manual .env loader (fallback for HF Spaces env issues) ───────────────────
function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, ".env");
    const lines = readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (key && val && !process.env[key]) {
        process.env[key] = val;
      }
    }
    console.log("✅ .env file loaded");
  } catch (_) {
    console.log("ℹ️  No .env file — using HF Secrets / environment variables");
  }
}
loadEnvFile();

function getKey(name) {
  const val = process.env[name];
  if (!val || !val.trim()) return null;
  return val.trim();
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "client/dist")));

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (_, res) => res.json({ ok: true }));

// ── DEBUG: visit your-space.hf.space/api/debug to diagnose key issues ────────
app.get("/api/debug", (_, res) => {
  const groqKey = getKey("GROQ_API_KEY");
  const hfKey   = getKey("HF_API_KEY");
  res.json({
    GROQ_API_KEY: groqKey
      ? `✅ Set (prefix: ${groqKey.slice(0, 7)}...)`
      : "❌ NOT SET — go to HF Space → Settings → Variables and Secrets → add GROQ_API_KEY",
    HF_API_KEY: hfKey
      ? `✅ Set (prefix: ${hfKey.slice(0, 5)}...)`
      : "❌ NOT SET — go to HF Space → Settings → Variables and Secrets → add HF_API_KEY",
    NODE_ENV: process.env.NODE_ENV || "(not set)",
    PORT:     process.env.PORT     || "(not set)",
    reminder: "After adding secrets → click 'Factory Reboot' (not just Restart)",
  });
});

// ── Groq proxy ────────────────────────────────────────────────────────────────
app.post("/api/groq", async (req, res) => {
  const key = getKey("GROQ_API_KEY");
  if (!key) {
    console.error("❌ GROQ_API_KEY missing — visit /api/debug");
    return res.status(500).json({ error: "GROQ_API_KEY not configured. Visit /api/debug for help." });
  }
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error("Groq error:", response.status, JSON.stringify(data));
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error("Groq fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── HuggingFace image generation proxy ───────────────────────────────────────
app.post("/api/generate-image", async (req, res) => {
  const hfKey = getKey("HF_API_KEY");
  if (!hfKey) {
    console.error("❌ HF_API_KEY missing — visit /api/debug");
    return res.status(500).json({ error: "HF_API_KEY not configured. Visit /api/debug for help." });
  }
  try {
    const { prompt, imageBase64, imageMime = "image/jpeg" } = req.body;
    const buffer = Buffer.from(imageBase64, "base64");
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
    const CRLF = "\r\n";

    const textPart =
      `--${boundary}${CRLF}Content-Disposition: form-data; name="inputs"${CRLF}${CRLF}${prompt}${CRLF}`;
    const paramPart =
      `--${boundary}${CRLF}Content-Disposition: form-data; name="parameters"${CRLF}${CRLF}` +
      JSON.stringify({
        strength: 0.65,
        guidance_scale: 7.5,
        num_inference_steps: 30,
        negative_prompt: "deformed, ugly, blurry, low quality, bad anatomy, distorted face, watermark, text",
      }) + CRLF;
    const imagePart =
      `--${boundary}${CRLF}Content-Disposition: form-data; name="image"; filename="input.jpg"${CRLF}` +
      `Content-Type: ${imageMime}${CRLF}${CRLF}`;
    const closing = `${CRLF}--${boundary}--${CRLF}`;

    const body = Buffer.concat([
      Buffer.from(textPart, "utf8"),
      Buffer.from(paramPart, "utf8"),
      Buffer.from(imagePart, "utf8"),
      buffer,
      Buffer.from(closing, "utf8"),
    ]);

    const HF_MODEL = process.env.HF_MODEL?.trim() || "runwayml/stable-diffusion-v1-5";

    const hfRes = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hfKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    });

    if (!hfRes.ok) {
      const errText = await hfRes.text();
      console.error("HF error:", hfRes.status, errText);
      if (hfRes.status === 503) {
        let wait = 25;
        try { const j = JSON.parse(errText); wait = Math.ceil(j.estimated_time || 25); } catch (_) {}
        return res.status(503).json({ type: "loading", wait, message: `Model warming up, retry in ${wait}s` });
      }
      return res.status(hfRes.status).json({ error: errText.slice(0, 300) });
    }

    const arrayBuffer = await hfRes.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);
    const mime = hfRes.headers.get("content-type") || "image/png";
    res.json({ imageBase64: imageBuffer.toString("base64"), mime });
  } catch (err) {
    console.error("Image gen error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fallback → React app
app.get("*", (_, res) =>
  res.sendFile(path.join(__dirname, "client/dist/index.html"))
);

const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
  console.log(`\n✅ Server on port ${PORT}`);
  console.log(`🔑 GROQ_API_KEY : ${getKey("GROQ_API_KEY") ? "✅ loaded" : "❌ MISSING"}`);
  console.log(`🔑 HF_API_KEY   : ${getKey("HF_API_KEY")   ? "✅ loaded" : "❌ MISSING"}`);
  console.log(`🔍 Debug URL    : http://localhost:${PORT}/api/debug\n`);
});
