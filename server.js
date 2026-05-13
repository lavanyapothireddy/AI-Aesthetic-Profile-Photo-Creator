import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import path from "path";
import { readFileSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── .env fallback loader ──────────────────────────────────────────────────────
function loadEnvFile() {
  try {
    const lines = readFileSync(path.join(__dirname, ".env"), "utf8").split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (k && v && !process.env[k]) process.env[k] = v;
    }
    console.log("✅ .env loaded");
  } catch (_) {
    console.log("ℹ️  No .env — using environment variables");
  }
}
loadEnvFile();

const getKey = (name) => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
};

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "client/dist")));

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (_, res) => res.json({ ok: true }));

// ── Debug ─────────────────────────────────────────────────────────────────────
app.get("/api/debug", (_, res) => {
  const gk = getKey("GROQ_API_KEY");
  const hk = getKey("HF_API_KEY");
  res.json({
    GROQ_API_KEY: gk ? `✅ Set (${gk.slice(0, 7)}...)` : "❌ NOT SET",
    HF_API_KEY:   hk ? `✅ Set (${hk.slice(0, 5)}...)` : "❌ NOT SET",
    PORT: process.env.PORT || "(not set)",
    reminder: "After adding secrets → Factory Reboot the Space",
  });
});

// ── Groq proxy ────────────────────────────────────────────────────────────────
app.post("/api/groq", async (req, res) => {
  const key = getKey("GROQ_API_KEY");
  if (!key) return res.status(500).json({ error: "GROQ_API_KEY not set. Visit /api/debug." });
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    if (!r.ok) { console.error("Groq error:", r.status, data); return res.status(r.status).json(data); }
    res.json(data);
  } catch (err) {
    console.error("Groq fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── HuggingFace Image Generation ──────────────────────────────────────────────
// Uses HF Inference API v2 — the current working standard (not the old /models/ endpoint)
// Model: black-forest-labs/FLUX.1-schnell — best free text-to-image model on HF right now
app.post("/api/generate-image", async (req, res) => {
  const hfKey = getKey("HF_API_KEY");
  if (!hfKey) return res.status(500).json({ error: "HF_API_KEY not set. Visit /api/debug." });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Missing prompt." });

  // ── Model selection ────────────────────────────────────────────────────────
  // FLUX.1-schnell: free, fast, excellent quality, no gating on HF free tier
  // Override via HF_MODEL env var if needed
  const model = getKey("HF_MODEL") || "black-forest-labs/FLUX.1-schnell";

  console.log(`🎨 Model  : ${model}`);
  console.log(`📝 Prompt : ${prompt.slice(0, 100)}...`);

  try {
    // HF Inference API v2 — correct current endpoint format
    const hfRes = await fetch(
      `https://router.huggingface.co/hf-inference/models/${model}/v1/text-to-image`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hfKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            num_inference_steps: 4,   // FLUX.1-schnell works best at 4 steps
            guidance_scale: 0,        // FLUX schnell uses 0 guidance
            width: 768,
            height: 768,
          },
        }),
      }
    );

    console.log(`HF response status: ${hfRes.status}`);
    console.log(`HF content-type   : ${hfRes.headers.get("content-type")}`);

    // ── Error handling ─────────────────────────────────────────────────────
    if (!hfRes.ok) {
      const errText = await hfRes.text();
      console.error(`HF error ${hfRes.status}:`, errText.slice(0, 300));

      if (hfRes.status === 503) {
        let wait = 20;
        try { wait = Math.ceil(JSON.parse(errText).estimated_time || 20); } catch (_) {}
        return res.status(503).json({ type: "loading", wait, message: `Model loading, retry in ${wait}s` });
      }

      if (hfRes.status === 401) {
        return res.status(401).json({ error: "HF token invalid or expired. Check your HF_API_KEY." });
      }

      if (hfRes.status === 403) {
        return res.status(403).json({ error: "HF token lacks Inference permission. Regenerate with 'Make calls to Inference Providers' checked." });
      }

      return res.status(hfRes.status).json({ error: `HF API error ${hfRes.status}: ${errText.slice(0, 200)}` });
    }

    // ── Success — HF returns raw image bytes ───────────────────────────────
    const contentType = hfRes.headers.get("content-type") || "image/jpeg";

    // Sometimes HF returns JSON even on 200 (e.g. queued job)
    if (contentType.includes("application/json")) {
      const jsonBody = await hfRes.json();
      console.error("Unexpected JSON response from HF:", jsonBody);
      return res.status(500).json({ error: "HF returned JSON instead of image. Try again.", detail: JSON.stringify(jsonBody) });
    }

    const arrayBuffer = await hfRes.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    if (imageBuffer.length < 1000) {
      console.error("Image buffer suspiciously small:", imageBuffer.length, "bytes");
      return res.status(500).json({ error: "HF returned an empty or corrupt image. Try again." });
    }

    console.log(`✅ Image generated — ${imageBuffer.length} bytes, type: ${contentType}`);
    res.json({ imageBase64: imageBuffer.toString("base64"), mime: contentType });

  } catch (err) {
    console.error("Image gen error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Fallback → React ──────────────────────────────────────────────────────────
app.get("*", (_, res) =>
  res.sendFile(path.join(__dirname, "client/dist/index.html"))
);

const PORT = process.env.PORT || 7860;
app.listen(PORT, () => {
  console.log(`\n✅ Server on :${PORT}`);
  console.log(`🔑 GROQ_API_KEY : ${getKey("GROQ_API_KEY") ? "✅" : "❌ MISSING"}`);
  console.log(`🔑 HF_API_KEY   : ${getKey("HF_API_KEY")   ? "✅" : "❌ MISSING"}`);
  console.log(`🔍 Debug        : http://localhost:${PORT}/api/debug\n`);
});
