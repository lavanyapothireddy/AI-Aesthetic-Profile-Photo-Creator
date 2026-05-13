import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// ── Serve React build in production ─────────────────────────────────────────
app.use(express.static(path.join(__dirname, "client/dist")));

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (_, res) => res.json({ ok: true }));

// ── Claude proxy ─────────────────────────────────────────────────────────────
app.post("/api/claude", async (req, res) => {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HuggingFace img2img proxy ─────────────────────────────────────────────────
// Receives { prompt, imageBase64, imageMime, parameters } JSON
// Forwards as multipart/form-data to HF Inference API
app.post("/api/generate-image", async (req, res) => {
  try {
    const { prompt, imageBase64, imageMime = "image/jpeg", parameters = {} } = req.body;

    // Rebuild binary from base64
    const buffer = Buffer.from(imageBase64, "base64");

    // Build multipart manually using a boundary
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
    const CRLF = "\r\n";

    const textPart =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="inputs"${CRLF}${CRLF}` +
      `${prompt}${CRLF}`;

    const paramPart =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="parameters"${CRLF}${CRLF}` +
      `${JSON.stringify({ strength: 0.6, guidance_scale: 7.5, num_inference_steps: 30, negative_prompt: "deformed, ugly, blurry, low quality, bad anatomy", ...parameters })}${CRLF}`;

    const imagePart =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="image"; filename="input.jpg"${CRLF}` +
      `Content-Type: ${imageMime}${CRLF}${CRLF}`;

    const closing = `${CRLF}--${boundary}--${CRLF}`;

    const bodyParts = [
      Buffer.from(textPart, "utf8"),
      Buffer.from(paramPart, "utf8"),
      Buffer.from(imagePart, "utf8"),
      buffer,
      Buffer.from(closing, "utf8"),
    ];
    const body = Buffer.concat(bodyParts);

    const HF_MODEL = process.env.HF_MODEL || "stabilityai/stable-diffusion-xl-refiner-1.0";
    const hfRes = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_API_KEY}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
      body,
    });

    if (!hfRes.ok) {
      const errText = await hfRes.text();
      if (hfRes.status === 503) {
        let wait = 25;
        try { const j = JSON.parse(errText); wait = Math.ceil(j.estimated_time || 25); } catch (_) {}
        return res.status(503).json({ type: "loading", wait, message: `Model warming up, retry in ${wait}s` });
      }
      return res.status(hfRes.status).json({ error: errText.slice(0, 300) });
    }

    // Stream image back as base64 so the client can display it
    const imageBuffer = await hfRes.buffer();
    const b64 = imageBuffer.toString("base64");
    const mime = hfRes.headers.get("content-type") || "image/png";
    res.json({ imageBase64: b64, mime });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Fallback to React app ────────────────────────────────────────────────────
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "client/dist/index.html")));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
