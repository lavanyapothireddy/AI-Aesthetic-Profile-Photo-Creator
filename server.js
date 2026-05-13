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
      if (key && val && !process.env[key]) process.env[key] = val;
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

// ── DEBUG ─────────────────────────────────────────────────────────────────────
app.get("/api/debug", (_, res) => {
  const groqKey = getKey("GROQ_API_KEY");
  const hfKey   = getKey("HF_API_KEY");
  res.json({
    GROQ_API_KEY: groqKey ? `✅ Set (prefix: ${groqKey.slice(0, 7)}...)` : "❌ NOT SET",
    HF_API_KEY:   hfKey   ? `✅ Set (prefix: ${hfKey.slice(0, 5)}...)`   : "❌ NOT SET",
    NODE_ENV: process.env.NODE_ENV || "(not set)",
    PORT:     process.env.PORT     || "(not set)",
    reminder: "After adding secrets → click 'Factory Reboot' (not just Restart)",
  });
});

// ── Groq proxy ────────────────────────────────────────────────────────────────
app.post("/api/groq", async (req, res) => {
  const key = getKey("GROQ_API_KEY");
  if (!key) {
    console.error("❌ GROQ_API_KEY missing");
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
// FIX: Switched from multipart/form-data to JSON body (correct for HF Inference API)
// FIX: runwayml/stable-diffusion-v1-5 is deprecated — using stable-diffusion-2-1
app.post("/api/generate-image", async (req, res) => {
  const hfKey = getKey("HF_API_KEY");
  if (!hfKey) {
    console.error("❌ HF_API_KEY missing");
    return res.status(500).json({ error: "HF_API_KEY not configured. Visit /api/debug for help." });
  }

  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt in request body." });
    }

    // runwayml/stable-diffusion-v1-5 → DEPRECATED on HF
    // stable-diffusion-2-1 → actively maintained, free tier, great quality
    const HF_MODEL = process.env.HF_MODEL?.trim() || "stabilityai/stable-diffusion-2-1";
    console.log(`🎨 Generating image with: ${HF_MODEL}`);
    console.log(`📝 Prompt: ${prompt.slice(0, 100)}...`);

    const hfRes = await fetch(
      `https://api-inference.huggingface.co/models/${HF_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hfKey}`,
          "Content-Type": "application/json",   // JSON — NOT multipart
          Accept: "image/png",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            guidance_scale: 7.5,
            num_inference_steps: 30,
            width: 768,
            height: 768,
            negative_prompt:
              "deformed, ugly, blurry, low quality, bad anatomy, distorted face, watermark, text, nsfw",
          },
        }),
      }
    );

    if (!hfRes.ok) {
      const errText = await hfRes.text();
      console.error("HF error:", hfRes.status, errText);

      // 503 = model cold start — tell client to retry after wait
      if (hfRes.status === 503) {
        let wait = 25;
        try {
          const j = JSON.parse(errText);
          wait = Math.ceil(j.estimated_time || 25);
        } catch (_) {}
        return res.status(503).json({
          type: "loading",
          wait,
          message: `Model warming up, retry in ${wait}s`,
        });
      }

      return res.status(hfRes.status).json({ error: errText.slice(0, 400) });
    }

    // HF returns raw image bytes (not JSON)
    const arrayBuffer = await hfRes.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);
    const mime = hfRes.headers.get("content-type") || "image/png";

    console.log(`✅ Image generated — ${imageBuffer.length} bytes`);
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
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`🔑 GROQ_API_KEY : ${getKey("GROQ_API_KEY") ? "✅ loaded" : "❌ MISSING"}`);
  console.log(`🔑 HF_API_KEY   : ${getKey("HF_API_KEY")   ? "✅ loaded" : "❌ MISSING"}`);
  console.log(`🔍 Debug URL    : http://localhost:${PORT}/api/debug\n`);
});
