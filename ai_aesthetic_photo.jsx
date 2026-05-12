import { useState, useRef, useCallback } from "react";

const STYLES = [
  { id: "cinematic", label: "Cinematic", icon: "🎬", desc: "Film-grade color grading, dramatic shadows" },
  { id: "editorial", label: "Editorial", icon: "📸", desc: "High-fashion magazine aesthetic" },
  { id: "anime", label: "Anime Art", icon: "✨", desc: "Japanese animation style portrait" },
  { id: "oil_painting", label: "Oil Painting", icon: "🎨", desc: "Classical fine art texture" },
  { id: "neon_cyberpunk", label: "Cyberpunk", icon: "🌆", desc: "Neon lights, futuristic vibes" },
  { id: "soft_pastel", label: "Soft Pastel", icon: "🌸", desc: "Dreamy, delicate color palette" },
  { id: "vintage_film", label: "Vintage Film", icon: "📷", desc: "Retro grain, faded tones" },
  { id: "minimalist", label: "Minimalist", icon: "⬜", desc: "Clean, pure white studio" },
];

const MOODS = ["Confident", "Mysterious", "Playful", "Elegant", "Bold", "Dreamy", "Professional", "Artistic"];

const LIGHTING = ["Golden Hour", "Studio Softbox", "Neon Glow", "Natural Diffused", "Dramatic Contrast", "Backlit Silhouette"];

export default function App() {
  const [step, setStep] = useState("upload"); // upload | configure | generating | result
  const [uploadedImage, setUploadedImage] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [selectedStyle, setSelectedStyle] = useState("cinematic");
  const [selectedMood, setSelectedMood] = useState("Confident");
  const [selectedLighting, setSelectedLighting] = useState("Golden Hour");
  const [customPrompt, setCustomPrompt] = useState("");
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("style");
  const fileRef = useRef();
  const dropRef = useRef();

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) {
      setError("Please upload a valid image file.");
      return;
    }
    setError("");
    const url = URL.createObjectURL(file);
    setUploadedImage(url);
    const reader = new FileReader();
    reader.onload = (e) => {
      const b64 = e.target.result.split(",")[1];
      setImageBase64(b64);
    };
    reader.readAsDataURL(file);
    setStep("configure");
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    handleFile(file);
  }, [handleFile]);

  const handleDragOver = (e) => e.preventDefault();

  const analyzeAndGenerate = async () => {
    if (!imageBase64) return;
    setIsLoading(true);
    setStep("generating");
    setProgress(10);
    setError("");

    try {
      // Step 1: Analyze the uploaded photo
      setProgress(20);
      const styleObj = STYLES.find(s => s.id === selectedStyle);

      const analysisRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: imageBase64 }
              },
              {
                type: "text",
                text: `Analyze this portrait photo and return ONLY valid JSON (no markdown, no backticks) with these exact fields:
{
  "face_shape": "description of face shape",
  "skin_tone": "description of skin tone",
  "hair": "hair color and style",
  "notable_features": "2-3 distinctive features",
  "current_mood": "emotional tone of the photo",
  "composition": "framing and composition notes",
  "suggestions": ["tip1", "tip2", "tip3"]
}`
              }
            ]
          }]
        })
      });

      setProgress(45);
      const analysisData = await analysisRes.json();
      let analysisText = analysisData.content?.[0]?.text || "{}";
      analysisText = analysisText.replace(/```json|```/g, "").trim();

      let analysis = {};
      try { analysis = JSON.parse(analysisText); } catch (_) { analysis = { suggestions: [] }; }
      setAiAnalysis(analysis);

      // Step 2: Generate the aesthetic prompt
      setProgress(65);
      const promptRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: `You are an expert AI image generation prompt engineer specializing in portrait photography.

Based on this portrait analysis:
${JSON.stringify(analysis, null, 2)}

Create a detailed, professional image generation prompt for this aesthetic transformation:
- Style: ${styleObj?.label} — ${styleObj?.desc}
- Mood: ${selectedMood}
- Lighting: ${selectedLighting}
${customPrompt ? `- Additional request: ${customPrompt}` : ""}

Generate a single, detailed prompt (150-200 words) optimized for Midjourney/DALL-E/Stable Diffusion. 
Include: subject description, lighting setup, color palette, camera specs, artistic style, post-processing style.
Make it vivid, specific, and professional. Do not include any preamble — just the prompt itself.`
          }]
        })
      });

      setProgress(85);
      const promptData = await promptRes.json();
      const finalPrompt = promptData.content?.[0]?.text || "";
      setGeneratedPrompt(finalPrompt);

      setProgress(100);
      setTimeout(() => setStep("result"), 400);
    } catch (err) {
      setError("Something went wrong. Please try again.");
      setStep("configure");
    } finally {
      setIsLoading(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setUploadedImage(null);
    setImageBase64(null);
    setAiAnalysis(null);
    setGeneratedPrompt("");
    setSelectedStyle("cinematic");
    setSelectedMood("Confident");
    setSelectedLighting("Golden Hour");
    setCustomPrompt("");
    setProgress(0);
    setError("");
  };

  const copyPrompt = () => {
    navigator.clipboard.writeText(generatedPrompt);
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f 0%, #12071e 50%, #07111e 100%)", fontFamily: "'Segoe UI', system-ui, sans-serif", color: "#e8e0f0" }}>
      {/* Header */}
      <div style={{ padding: "28px 32px 0", display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: "linear-gradient(135deg, #8b5cf6, #ec4899)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>✦</div>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, background: "linear-gradient(90deg, #c084fc, #f472b6, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>AI Aesthetic Profile Creator</h1>
          <p style={{ margin: 0, fontSize: 12, color: "#7c6a9a" }}>Transform your photo into a stunning aesthetic portrait</p>
        </div>
      </div>

      {/* Steps indicator */}
      <div style={{ padding: "20px 32px", display: "flex", gap: 8, alignItems: "center" }}>
        {["Upload", "Configure", "Generate", "Result"].map((s, i) => {
          const stepMap = { 0: "upload", 1: "configure", 2: "generating", 3: "result" };
          const currentIdx = ["upload", "configure", "generating", "result"].indexOf(step);
          const active = i <= currentIdx;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: active ? "linear-gradient(135deg, #8b5cf6, #ec4899)" : "#1e1530", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: active ? "#fff" : "#4a3a6a", transition: "all 0.3s" }}>{i + 1}</div>
                <span style={{ fontSize: 12, color: active ? "#c084fc" : "#4a3a6a", fontWeight: active ? 600 : 400 }}>{s}</span>
              </div>
              {i < 3 && <div style={{ width: 32, height: 1, background: active && i < currentIdx ? "#8b5cf6" : "#1e1530" }} />}
            </div>
          );
        })}
      </div>

      <div style={{ padding: "0 32px 32px" }}>

        {/* UPLOAD STEP */}
        {step === "upload" && (
          <div
            ref={dropRef}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileRef.current?.click()}
            style={{ border: "2px dashed #3d2b5e", borderRadius: 20, padding: "64px 32px", textAlign: "center", cursor: "pointer", transition: "all 0.2s", background: "rgba(139,92,246,0.04)" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#8b5cf6"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#3d2b5e"}
          >
            <div style={{ fontSize: 56, marginBottom: 16 }}>📸</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#e8e0f0" }}>Drop your photo here</h2>
            <p style={{ margin: "0 0 20px", color: "#7c6a9a", fontSize: 14 }}>or click to browse — JPG, PNG, WEBP supported</p>
            <div style={{ display: "inline-block", padding: "10px 28px", borderRadius: 10, background: "linear-gradient(135deg, #8b5cf6, #ec4899)", fontSize: 14, fontWeight: 600, color: "#fff" }}>Choose Photo</div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
          </div>
        )}

        {/* CONFIGURE STEP */}
        {step === "configure" && (
          <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 24 }}>
            {/* Left: image preview */}
            <div>
              <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid #2d1f4e", position: "relative" }}>
                <img src={uploadedImage} alt="Uploaded" style={{ width: "100%", display: "block", maxHeight: 340, objectFit: "cover" }} />
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "8px 12px", background: "linear-gradient(transparent, rgba(10,5,20,0.9))", fontSize: 12, color: "#c084fc" }}>✓ Photo ready</div>
              </div>
              <button onClick={reset} style={{ marginTop: 12, width: "100%", padding: "9px", borderRadius: 10, border: "1px solid #3d2b5e", background: "transparent", color: "#7c6a9a", fontSize: 13, cursor: "pointer" }}>← Upload different photo</button>
            </div>

            {/* Right: options */}
            <div>
              {/* Tabs */}
              <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#0e0a1a", borderRadius: 12, padding: 4 }}>
                {["style", "mood", "lighting", "custom"].map(t => (
                  <button key={t} onClick={() => setActiveTab(t)} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: activeTab === t ? "linear-gradient(135deg,#8b5cf6,#ec4899)" : "transparent", color: activeTab === t ? "#fff" : "#7c6a9a", fontSize: 13, fontWeight: 600, cursor: "pointer", textTransform: "capitalize" }}>{t}</button>
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
                    <button key={m} onClick={() => setSelectedMood(m)} style={{ padding: "10px 20px", borderRadius: 40, border: `1.5px solid ${selectedMood === m ? "#ec4899" : "#2d1f4e"}`, background: selectedMood === m ? "rgba(236,72,153,0.15)" : "transparent", color: selectedMood === m ? "#f472b6" : "#7c6a9a", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}>{m}</button>
                  ))}
                </div>
              )}

              {activeTab === "lighting" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {LIGHTING.map(l => (
                    <div key={l} onClick={() => setSelectedLighting(l)} style={{ padding: "16px", borderRadius: 14, border: `1.5px solid ${selectedLighting === l ? "#818cf8" : "#2d1f4e"}`, background: selectedLighting === l ? "rgba(129,140,248,0.12)" : "transparent", cursor: "pointer", transition: "all 0.15s" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: selectedLighting === l ? "#a5b4fc" : "#9a8ab0" }}>{l}</div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "custom" && (
                <div>
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: "#7c6a9a" }}>Add any special instructions or style details:</p>
                  <textarea
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value)}
                    placeholder="e.g. Add flowers in my hair, make it look like a professional LinkedIn headshot, use purple as the dominant color..."
                    style={{ width: "100%", minHeight: 140, borderRadius: 14, border: "1.5px solid #2d1f4e", background: "rgba(255,255,255,0.02)", color: "#e8e0f0", fontSize: 13, padding: 16, resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                  />
                </div>
              )}

              {error && <div style={{ marginTop: 12, padding: "10px 16px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: 13 }}>{error}</div>}

              {/* Summary */}
              <div style={{ marginTop: 20, padding: "14px 18px", borderRadius: 14, background: "rgba(139,92,246,0.07)", border: "1px solid #2d1f4e", display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "#9a8ab0" }}>
                <span>Style: <strong style={{ color: "#c084fc" }}>{STYLES.find(s => s.id === selectedStyle)?.label}</strong></span>
                <span>Mood: <strong style={{ color: "#f472b6" }}>{selectedMood}</strong></span>
                <span>Lighting: <strong style={{ color: "#a5b4fc" }}>{selectedLighting}</strong></span>
              </div>

              <button onClick={analyzeAndGenerate} style={{ marginTop: 16, width: "100%", padding: "15px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", letterSpacing: 0.3 }}>
                ✦ Generate Aesthetic Profile
              </button>
            </div>
          </div>
        )}

        {/* GENERATING STEP */}
        {step === "generating" && (
          <div style={{ textAlign: "center", padding: "60px 32px" }}>
            <div style={{ fontSize: 56, marginBottom: 24, animation: "spin 3s linear infinite", display: "inline-block" }}>✦</div>
            <h2 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 700, background: "linear-gradient(90deg,#c084fc,#f472b6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Crafting your aesthetic...</h2>
            <p style={{ margin: "0 0 32px", color: "#7c6a9a", fontSize: 14 }}>AI is analyzing your photo and generating the perfect prompt</p>
            <div style={{ maxWidth: 360, margin: "0 auto" }}>
              <div style={{ height: 6, borderRadius: 6, background: "#1e1530", overflow: "hidden", marginBottom: 16 }}>
                <div style={{ height: "100%", borderRadius: 6, background: "linear-gradient(90deg,#8b5cf6,#ec4899)", width: `${progress}%`, transition: "width 0.5s ease" }} />
              </div>
              <div style={{ fontSize: 13, color: "#5a4a7a" }}>
                {progress < 30 ? "Analyzing your photo..." : progress < 60 ? "Detecting features & aesthetics..." : progress < 85 ? "Crafting your perfect prompt..." : "Almost done..."}
              </div>
            </div>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* RESULT STEP */}
        {step === "result" && (
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 24 }}>
            {/* Left: original */}
            <div>
              <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid #2d1f4e" }}>
                <div style={{ padding: "10px 14px", background: "#0e0a1a", fontSize: 12, color: "#7c6a9a", fontWeight: 600 }}>📸 Original Photo</div>
                <img src={uploadedImage} alt="Original" style={{ width: "100%", display: "block", maxHeight: 280, objectFit: "cover" }} />
              </div>

              {aiAnalysis && (
                <div style={{ marginTop: 16, padding: "16px", borderRadius: 16, background: "#0e0a1a", border: "1px solid #2d1f4e" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#c084fc", marginBottom: 12 }}>AI Analysis</div>
                  {Object.entries(aiAnalysis).filter(([k]) => k !== "suggestions").map(([k, v]) => (
                    <div key={k} style={{ marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: "#5a4a7a", textTransform: "uppercase", letterSpacing: 0.5 }}>{k.replace(/_/g, " ")}</span>
                      <div style={{ fontSize: 12, color: "#9a8ab0", marginTop: 2 }}>{v}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right: generated prompt */}
            <div>
              <div style={{ borderRadius: 16, background: "#0e0a1a", border: "1px solid #2d1f4e", overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid #2d1f4e", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#e8e0f0" }}>✦ Your Aesthetic Prompt</div>
                    <div style={{ fontSize: 12, color: "#5a4a7a", marginTop: 2 }}>Ready to use in Midjourney, DALL·E, Stable Diffusion</div>
                  </div>
                  <button onClick={copyPrompt} style={{ padding: "8px 18px", borderRadius: 10, border: "1.5px solid #3d2b5e", background: "transparent", color: "#c084fc", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Copy</button>
                </div>
                <div style={{ padding: "20px 18px", fontSize: 14, lineHeight: 1.8, color: "#c8b8e8", whiteSpace: "pre-wrap" }}>{generatedPrompt}</div>
              </div>

              {/* Style badges */}
              <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                {[
                  { label: STYLES.find(s => s.id === selectedStyle)?.label, color: "#c084fc", bg: "rgba(192,132,252,0.12)" },
                  { label: selectedMood, color: "#f472b6", bg: "rgba(244,114,182,0.12)" },
                  { label: selectedLighting, color: "#a5b4fc", bg: "rgba(165,180,252,0.12)" },
                ].map(b => (
                  <div key={b.label} style={{ padding: "6px 16px", borderRadius: 40, background: b.bg, color: b.color, fontSize: 12, fontWeight: 600 }}>{b.label}</div>
                ))}
              </div>

              {/* Pro tips */}
              {aiAnalysis?.suggestions?.length > 0 && (
                <div style={{ marginTop: 20, padding: "18px", borderRadius: 16, background: "rgba(139,92,246,0.06)", border: "1px solid #2d1f4e" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#8b5cf6", marginBottom: 12 }}>💡 AI Photo Tips</div>
                  {aiAnalysis.suggestions.map((tip, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(139,92,246,0.2)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#c084fc", fontWeight: 700 }}>{i + 1}</div>
                      <div style={{ fontSize: 13, color: "#9a8ab0", lineHeight: 1.5 }}>{tip}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
                <button onClick={() => setStep("configure")} style={{ flex: 1, padding: "13px", borderRadius: 12, border: "1.5px solid #3d2b5e", background: "transparent", color: "#9a8ab0", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>← Adjust Settings</button>
                <button onClick={reset} style={{ flex: 1, padding: "13px", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#8b5cf6,#ec4899)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>✦ New Photo</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
