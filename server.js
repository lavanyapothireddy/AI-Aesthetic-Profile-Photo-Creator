import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// Serve React build
app.use(express.static(path.join(__dirname, "client/dist")));

// Health check
app.get("/api/health", (_, res) => res.json({ ok: true }));

// ── Groq proxy ────────────────────────────────────────────────────────────────
app.post("/api/groq", async (req, res) => {
  // BUG FIX #1: Validate and trim the key — undefined key causes 401
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    console.error("GROQ_API_KEY is not set in environment variables.");
    return res.status(500).json({ error: "GROQ_API_KEY is not configured on the server." });
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,  // BUG FIX #1: use trimmed key
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Groq API error:", response.status, JSON.stringify(data));
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
  // BUG FIX #4: Validate HF key too
  const hfKey = process.env.HF_API_KEY?.trim();
  if (!hfKey) {
    return res.status(500).json({ error: "HF_API_KEY is not configured on the server." });
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
        negative_prompt:
          "deformed, ugly, blurry, low quality, bad anatomy, distorted face, watermark, text",
      }) +
      CRLF;

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

    // BUG FIX #3: Use a model that actually supports img2img on HF Inference API
    // stabilityai/stable-diffusion-xl-refiner-1.0 does NOT support image input
    const HF_MODEL =
      process.env.HF_MODEL || "runwayml/stable-diffusion-v1-5";

    const hfRes = await fetch(
      `https://api-inference.huggingface.co/models/${HF_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hfKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(body.length),
        },
        body,
      }
    );

    if (!hfRes.ok) {
      const errText = await hfRes.text();
      console.error("HF error:", hfRes.status, errText);

      if (hfRes.status === 503) {
        let wait = 25;
        try {
          const j = JSON.parse(errText);
          wait = Math.ceil(j.estimated_time || 25);
        } catch (_) {}
        return res
          .status(503)
          .json({ type: "loading", wait, message: `Model warming up, retry in ${wait}s` });
      }

      return res.status(hfRes.status).json({ error: errText.slice(0, 300) });
    }

    // BUG FIX #4: node-fetch v3 removed .buffer() — use .arrayBuffer() instead
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

// BUG FIX #6: HuggingFace Spaces REQUIRES port 7860
const PORT = process.env.PORT || 7860;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
