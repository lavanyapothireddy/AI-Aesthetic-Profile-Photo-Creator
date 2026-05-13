import { useState, useRef, useCallback } from "react";

const STYLES = [
  { id: "cinematic",      label: "Cinematic",    icon: "🎬", desc: "Film-grade color grading, dramatic shadows",  sdKeywords: "cinematic film still, dramatic lighting, shallow depth of field, anamorphic lens flare, color graded" },
  { id: "editorial",      label: "Editorial",    icon: "📸", desc: "High-fashion magazine aesthetic",             sdKeywords: "high fashion editorial, Vogue magazine, professional studio photography, high contrast" },
  { id: "anime",          label: "Anime Art",    icon: "✨", desc: "Japanese animation style portrait",           sdKeywords: "anime portrait, studio ghibli inspired, cel shading, vibrant colors, detailed anime art style" },
  { id: "oil_painting",   label: "Oil Painting", icon: "🎨", desc: "Classical fine art texture",                 sdKeywords: "oil painting portrait, classical fine art, thick brushstrokes, renaissance style, rich textures" },
  { id: "neon_cyberpunk", label: "Cyberpunk",    icon: "🌆", desc: "Neon lights, futuristic vibes",              sdKeywords: "cyberpunk neon lights, futuristic city, synthwave colors, purple and cyan neon glow, blade runner" },
  { id: "soft_pastel",    label: "Soft Pastel",  icon: "🌸", desc: "Dreamy, delicate color palette",            sdKeywords: "soft pastel colors, dreamy bokeh, watercolor wash, delicate pink and lavender tones, ethereal" },
  { id: "vintage_film",   label: "Vintage Film", icon: "📷", desc: "Retro grain, faded tones",                   sdKeywords: "vintage film photography, 35mm grain, faded kodachrome tones, retro 1970s aesthetic, analog warmth" },
  { id: "minimalist",     label: "Minimalist",   icon: "⬜", desc: "Clean, pure white studio",                   sdKeywords: "minimalist white studio, clean background, pure light, high key photography, editorial simplicity" },
];

const MOODS    = ["Confident", "Mysterious", "Playful", "Elegant", "Bold", "Dreamy", "Professional", "Artistic"];
const LIGHTING = ["Golden Hour", "Studio Softbox", "Neon Glow", "Natural Diffused", "Dramatic Contrast", "Backlit Silhouette"];

// ── API helpers (all proxied through Express) ─────────────────────────────────

// Vision call — Groq Llama 4 Scout (supports image_url with base64)
async function groqVision(imageBase64, imageMime, textPrompt) {
  const res = await fetch("/api/groq", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
          { type: "text", text: textPrompt },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Groq vision error ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// Text call — Groq Llama 3.3 70B (best quality for prompt generation)
async function groqText(systemPrompt, userPrompt) {
  const res = await fetch("/api/groq", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: 500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq text error ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// HuggingFace img2img (with cold-start retry)
async function generateImage(prompt, imageBase64, imageMime) {
  const res = await fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, imageBase64, imageMime }),
  });
  const data = await res.json();
  if (res.status === 503 && data.type === "loading") {
    await new Promise(r => setTimeout(r, (data.wait || 25) * 1000));
    return generateImage(prompt, imageBase64, imageMime); // retry once
  }
  if (!res.ok) throw new Error(data.error || "Image generation failed");
  return `data:${data.mime};base64,${data.imageBase64}`;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function App() {
  const [step,             setStep]             = useState("upload");
  const [uploadedImage,    setUploadedImage]    = useState(null);
  const [imageBase64,      setImageBase64]      = useState(null);
  const [imageMime,        setImageMime]        = useState("image/jpeg");
  const [selectedStyle,    setSelectedStyle]    = useState("cinematic");
  const [selectedMood,     setSelectedMood]     = useState("Confident");
  const [selectedLighting, setSelectedLighting] = useState("Golden Hour");
  const [customPrompt,     setCustomPrompt]     = useState("");
  const [aiAnalysis,       setAiAnalysis]       = useState(null);
  const [generatedPrompt,  setGeneratedPrompt]  = useState("");
  const [generatedImage,   setGeneratedImage]   = useState(null);
  const [progress,         setProgress]         = useState(0);
  const [progressLabel,    setProgressLabel]    = useState("");
  const [error,            setError]            = useState("");
  const [activeTab,        setActiveTab]        = useState("style");
  const fileRef = useRef();

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) { setError("Please upload a valid image file."); return; }
    setError("");
    setImageMime(file.type || "image/jpeg");
    setUploadedImage(URL.createObjectURL(file));
    const reader = new FileReader();
    reader.onload = (e) => setImageBase64(e.target.result.split(",")[1]);
    reader.readAsDataURL(file);
    setStep("configure");
  }, []);

  const handleDrop = useCallback((e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }, [handleFile]);

  const analyzeAndGenerate = async () => {
    if (!imageBase64) return;
    setError(""); setStep("generating"); setProgress(5);

    try {
      // ── 1. Groq Vision — analyze the photo ──────────────────────────────
      setProgressLabel("Analyzing your photo with Groq Llama 4 Scout...");
      setProgress(15);

      const rawAnalysis = await groqVision(
        imageBase64,
        imageMime,
        `Analyze this portrait photo and return ONLY valid JSON (no markdown, no backticks, no extra text):
{"face_shape":"...","skin_tone":"...","hair":"...","notable_features":"...","current_mood":"...","composition":"...","suggestions":["tip1","tip2","tip3"]}`
      );

      setProgress(36);
      let analysis = {};
      try { analysis = JSON.parse(rawAnalysis.replace(/```json|```/g, "").trim()); }
      catch (_) { analysis = { suggestions: [] }; }
      setAiAnalysis(analysis);

      // ── 2. Groq Text — generate SD prompt ───────────────────────────────
      setProgressLabel("Crafting your Stable Diffusion prompt with Groq...");
      setProgress(54);

      const styleObj = STYLES.find(s => s.id === selectedStyle);
      const finalPrompt = await groqText(
        "You are an expert Stable Diffusion img2img prompt engineer. Return only the prompt — no preamble, no explanation.",
        `Portrait analysis: ${JSON.stringify(analysis)}
Style: ${styleObj?.label} — SD keywords: ${styleObj?.sdKeywords}
Mood: ${selectedMood}
Lighting: ${selectedLighting}
${customPrompt ? `Extra request: ${customPrompt}` : ""}

Write a single optimized img2img prompt (100-140 words). Preserve the subject's face and identity. Include: detailed subject description, lighting, color palette, camera lens, art style keywords, quality boosters like "masterpiece, best quality, highly detailed, 8k".`
      );

      setProgress(68);
      setGeneratedPrompt(finalPrompt);

      // ── 3. HuggingFace — generate the image ─────────────────────────────
      setProgressLabel("Generating your aesthetic image on HuggingFace...");
      setProgress(76);

      const imageDataUrl = await generateImage(finalPrompt, imageBase64, imageMime);
      setGeneratedImage(imageDataUrl);

      setProgress(100);
      setProgressLabel("Done! ✨");
      setTimeout(() => setStep("result"), 400);

    } catch (err) {
      console.error(err);
      setError(err.message || "Something went wrong. Please try again.");
      setStep("configure");
    }
  };

  const reset = () => {
    setStep("upload"); setUploadedImage(null); setImageBase64(null); setAiAnalysis(null);
    setGeneratedPrompt(""); setGeneratedImage(null); setSelectedStyle("cinematic");
    setSelectedMood("Confident"); setSelectedLighting("Golden Hour"); setCustomPrompt("");
    setProgress(0); setProgressLabel(""); setError("");
  };

  const card     = { borderRadius: 16, border: "1px solid #2d1f4e", background: "#0e0a1a", overflow: "hidden" };
  const gradBtn  = { border: "none", background: "linear-gradient(135deg,#8b5cf6,#ec4899)", color: "#fff", borderRadius: 12, cursor: "pointer", fontWeight: 700 };
  const ghostBtn = { border: "1.5px solid #3d2b5e", background: "transparent", color: "#9a8ab0", borderRadius: 12, cursor: "pointer", fontWeight: 600 };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#0a0a0f 0%,#12071e 50%,#07111e 100%)", fontFamily: "'Segoe UI',system-ui,sans-serif", color: "#e8e0f0" }}>

      {/* Header */}
      <div style={{ padding: "24px 32px 0", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: "linear-gradient(135deg,#8b5cf6,#ec4899)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>✦</div>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, background: "linear-gradient(90deg,#c084fc,#f472b6,#818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            AI Aesthetic Profile Creator
          </h1>
          <p style={{ margin: 0, fontSize: 12, color: "#7c6a9a" }}>
            Groq Llama 4 (vision) + Llama 3.3 70B (prompt) + HuggingFace img2img — 100% free APIs
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <div style={{ padding: "18px 32px", display: "flex", gap: 8, alignItems: "center" }}>
        {["Upload", "Configure", "Generate", "Result"].map((s, i) => {
          const idx = ["upload", "configure", "generating", "result"].indexOf(step);
          const active = i <= idx;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: active ? "linear-gradient(135deg,#8b5cf6,#ec4899)" : "#1e1530", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: active ? "#fff" : "#4a3a6a", transition: "all 0.3s" }}>{i + 1}</div>
                <span style={{ fontSize: 12, color: active ? "#c084fc" : "#4a3a6a", fontWeight: active ? 600 : 400 }}>{s}</span>
              </div>
              {i < 3 && <div style={{ width: 32, height: 1, background: active && i < idx ? "#8b5cf6" : "#1e1530" }} />}
            </div>
          );
        })}
      </div>

      <div style={{ padding: "0 32px 48px" }}>

        {/* ── UPLOAD ── */}
        {step === "upload" && (
          <div
            onDrop={handleDrop} onDragOver={e => e.preventDefault()} onClick={() => fileRef.current?.click()}
            style={{ border: "2px dashed #3d2b5e", borderRadius: 20, padding: "80px 32px", textAlign: "center", cursor: "pointer", background: "rgba(139,92,246,0.03)", transition: "border-color 0.2s" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#8b5cf6"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#3d2b5e"}
          >
            <div style={{ fontSize: 64, marginBottom: 20 }}>📸</div>
            <h2 style={{ margin: "0 0 10px", fontSize: 24, fontWeight: 700 }}>Drop your portrait here</h2>
            <p style={{ margin: "0 0 8px", color: "#7c6a9a", fontSize: 14 }}>JPG, PNG, WEBP — works best with face/portrait photos</p>
            <p style={{ margin: "0 0 28px", color: "#4a3a6a", fontSize: 12 }}>Your image is only used for generation — never stored</p>
            <div style={{ display: "inline-block", padding: "13px 36px", borderRadius: 12, background: "linear-gradient(135deg,#8b5cf6,#ec4899)", fontSize: 15, fontWeight: 700 }}>Choose Photo</div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
          </div>
        )}

        {/* ── CONFIGURE ── */}
        {step === "configure" && (
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 24 }}>
            <div>
              <div style={card}>
                <img src={uploadedImage} alt="Uploaded" style={{ width: "100%", display: "block", maxHeight: 320, objectFit: "cover" }} />
                <div style={{ padding: "8px 14px", fontSize: 12, color: "#c084fc", background: "rgba(139,92,246,0.08)" }}>✓ Photo loaded</div>
              </div>
              <button onClick={reset} style={{ ...ghostBtn, marginTop: 10, width: "100%", padding: 10, fontSize: 13 }}>← Use different photo</button>
            </div>

            <div>
              <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#0e0a1a", borderRadius: 12, padding: 4 }}>
                {["style", "mood", "lighting", "custom"].map(t => (
                  <button key={t} onClick={() => setActiveTab(t)} style={{ flex: 1, padding: 9, borderRadius: 8, border: "none", background: activeTab === t ? "linear-gradient(135deg,#8b5cf6,#ec4899)" : "transparent", color: activeTab === t ? "#fff" : "#7c6a9a", fontSize: 13, fontWeight: 600, cursor: "pointer", textTransform: "capitalize" }}>{t}</button>
                ))}
              </div>

              {activeTab === "style" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {STYLES.map(s => (
                    <div key={s.id} onClick={() => setSelectedStyle(s.id)} style={{ padding: "14px 16px", borderRadius: 14, border: `1.5px solid ${selectedStyle === s.id ? "#8b5cf6" : "#2d1f4e"}`, background: selectedStyle === s.id ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.02)", cursor: "pointer", transition: "all 0.15s" }}>
                      <div style={{ fontSize: 22, marginBottom: 6 }}>{s.icon}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: selectedStyle === s.id ? "#c084fc" : "#b8a8d0" }}>{s.label}</div>
                      <div style={{ fontSize: 11, color: "#5a4a7a", marginTop: 3 }}>{s.desc}</div>
                    </div>
                  ))}
                </div>
              )}
              {activeTab === "mood" && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {MOODS.map(m => (
                    <button key={m} onClick={() => setSelectedMood(m)} style={{ padding: "10px 22px", borderRadius: 40, border: `1.5px solid ${selectedMood === m ? "#ec4899" : "#2d1f4e"}`, background: selectedMood === m ? "rgba(236,72,153,0.15)" : "transparent", color: selectedMood === m ? "#f472b6" : "#7c6a9a", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{m}</button>
                  ))}
                </div>
              )}
              {activeTab === "lighting" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {LIGHTING.map(l => (
                    <div key={l} onClick={() => setSelectedLighting(l)} style={{ padding: "16px", borderRadius: 14, border: `1.5px solid ${selectedLighting === l ? "#818cf8" : "#2d1f4e"}`, background: selectedLighting === l ? "rgba(129,140,248,0.12)" : "transparent", cursor: "pointer" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: selectedLighting === l ? "#a5b4fc" : "#9a8ab0" }}>{l}</div>
                    </div>
                  ))}
                </div>
              )}
              {activeTab === "custom" && (
                <div>
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: "#7c6a9a" }}>Add special instructions:</p>
                  <textarea value={customPrompt} onChange={e => setCustomPrompt(e.target.value)} placeholder="e.g. Add flowers in hair, LinkedIn headshot, purple dominant color..." style={{ width: "100%", minHeight: 140, borderRadius: 14, border: "1.5px solid #2d1f4e", background: "rgba(255,255,255,0.02)", color: "#e8e0f0", fontSize: 13, padding: 16, resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              )}

              {error && <div style={{ marginTop: 12, padding: "10px 16px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: 13 }}>{error}</div>}

              <div style={{ marginTop: 18, padding: "12px 18px", borderRadius: 14, background: "rgba(139,92,246,0.06)", border: "1px solid #2d1f4e", display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: "#9a8ab0" }}>
                <span>Style: <strong style={{ color: "#c084fc" }}>{STYLES.find(s => s.id === selectedStyle)?.label}</strong></span>
                <span>Mood: <strong style={{ color: "#f472b6" }}>{selectedMood}</strong></span>
                <span>Lighting: <strong style={{ color: "#a5b4fc" }}>{selectedLighting}</strong></span>
              </div>
              <button onClick={analyzeAndGenerate} style={{ ...gradBtn, marginTop: 16, width: "100%", padding: 16, fontSize: 16, letterSpacing: 0.3 }}>
                ✦ Analyze & Generate Aesthetic Image
              </button>
            </div>
          </div>
        )}

        {/* ── GENERATING ── */}
        {step === "generating" && (
          <div style={{ textAlign: "center", padding: "80px 32px" }}>
            <div style={{ fontSize: 60, marginBottom: 24, display: "inline-block", animation: "spin 3s linear infinite" }}>✦</div>
            <h2 style={{ margin: "0 0 10px", fontSize: 26, fontWeight: 700, background: "linear-gradient(90deg,#c084fc,#f472b6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Creating your aesthetic portrait...
            </h2>
            <p style={{ margin: "0 0 6px", color: "#9a8ab0", fontSize: 14 }}>{progressLabel}</p>
            <p style={{ margin: "0 0 36px", color: "#4a3a6a", fontSize: 12 }}>
              {progress > 68
                ? "HuggingFace image generation takes 20–60s. Cold start may add time."
                : "Groq is running at 300–800 tokens/sec — analysis & prompt done in seconds!"}
            </p>
            <div style={{ maxWidth: 420, margin: "0 auto" }}>
              <div style={{ height: 8, borderRadius: 8, background: "#1e1530", overflow: "hidden", marginBottom: 10 }}>
                <div style={{ height: "100%", borderRadius: 8, background: "linear-gradient(90deg,#8b5cf6,#ec4899)", width: `${progress}%`, transition: "width 0.7s ease" }} />
              </div>
              <div style={{ fontSize: 13, color: "#5a4a7a" }}>{progress}%</div>
            </div>

            {/* Model labels */}
            <div style={{ marginTop: 28, display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
              {[
                { label: "Llama 4 Scout", sub: "Vision analysis", done: progress > 36 },
                { label: "Llama 3.3 70B", sub: "Prompt generation", done: progress > 68 },
                { label: "HuggingFace SD", sub: "Image generation", done: progress >= 100 },
              ].map(m => (
                <div key={m.label} style={{ padding: "10px 16px", borderRadius: 12, background: m.done ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.02)", border: `1px solid ${m.done ? "#8b5cf6" : "#2d1f4e"}`, textAlign: "center", minWidth: 130 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: m.done ? "#c084fc" : "#4a3a6a" }}>{m.done ? "✓ " : "○ "}{m.label}</div>
                  <div style={{ fontSize: 11, color: "#5a4a7a", marginTop: 2 }}>{m.sub}</div>
                </div>
              ))}
            </div>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* ── RESULT ── */}
        {step === "result" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
              <div style={card}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #2d1f4e", fontSize: 13, color: "#7c6a9a", fontWeight: 600 }}>📸 Original</div>
                <img src={uploadedImage} alt="Original" style={{ width: "100%", display: "block", maxHeight: 440, objectFit: "cover" }} />
              </div>
              <div style={card}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #2d1f4e", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#c084fc" }}>✦ Aesthetic Result</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[{ label: STYLES.find(s => s.id === selectedStyle)?.label, c: "#c084fc" }, { label: selectedMood, c: "#f472b6" }].map(b => (
                      <span key={b.label} style={{ padding: "3px 10px", borderRadius: 20, background: "rgba(139,92,246,0.15)", color: b.c, fontSize: 11, fontWeight: 600 }}>{b.label}</span>
                    ))}
                  </div>
                </div>
                {generatedImage
                  ? <img src={generatedImage} alt="Generated" style={{ width: "100%", display: "block", maxHeight: 440, objectFit: "cover" }} />
                  : <div style={{ height: 440, display: "flex", alignItems: "center", justifyContent: "center", color: "#4a3a6a" }}>Generation failed</div>}
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
              <button
                onClick={() => { const a = document.createElement("a"); a.href = generatedImage; a.download = "aesthetic-portrait.png"; a.click(); }}
                style={{ ...gradBtn, flex: 1, padding: 14, fontSize: 15 }}
              >⬇ Download Image</button>
              <button onClick={() => setStep("configure")} style={{ ...ghostBtn, flex: 1, padding: 14, fontSize: 14 }}>← Adjust Style</button>
              <button onClick={reset} style={{ ...ghostBtn, flex: 1, padding: 14, fontSize: 14 }}>✦ New Photo</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {aiAnalysis && (
                <div style={{ ...card, padding: "18px" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#c084fc", marginBottom: 14 }}>🔍 AI Analysis</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                    {Object.entries(aiAnalysis).filter(([k]) => k !== "suggestions").map(([k, v]) => (
                      <div key={k} style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid #1e1530" }}>
                        <div style={{ fontSize: 10, color: "#5a4a7a", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>{k.replace(/_/g, " ")}</div>
                        <div style={{ fontSize: 12, color: "#9a8ab0", lineHeight: 1.4 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {aiAnalysis?.suggestions?.length > 0 && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#8b5cf6", marginBottom: 10 }}>💡 Photo Tips</div>
                      {aiAnalysis.suggestions.map((tip, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
                          <div style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(139,92,246,0.2)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#c084fc", fontWeight: 700 }}>{i + 1}</div>
                          <div style={{ fontSize: 12, color: "#9a8ab0", lineHeight: 1.5 }}>{tip}</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
              <div style={card}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #2d1f4e", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e8e0f0" }}>Generated SD Prompt</div>
                  <button onClick={() => navigator.clipboard.writeText(generatedPrompt)} style={{ ...ghostBtn, padding: "5px 14px", fontSize: 12 }}>Copy</button>
                </div>
                <div style={{ padding: "16px", fontSize: 13, color: "#c8b8e8", lineHeight: 1.8, maxHeight: 260, overflowY: "auto" }}>{generatedPrompt}</div>
                <div style={{ padding: "10px 16px", borderTop: "1px solid #1e1530", fontSize: 11, color: "#4a3a6a" }}>Reusable in Midjourney, ComfyUI, or any SD tool</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
