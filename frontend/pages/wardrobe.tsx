/**
 * pages/wardrobe.tsx — Wardrobe management page
 *
 * Review panel asks user ONLY: category, color, pattern.
 * Season + formality are AI-only — never shown to user.
 *
 * Color section:
 *   - Preset swatches (excluding "pattern")
 *   - Eyedropper: click image → canvas samples the pixel → sets custom hex
 *   - Custom hex input fallback
 *
 * Pattern section (separate from color):
 *   - Shown only when "Has a pattern" is toggled on
 *   - Dropdown with pattern name + inline SVG swatch preview
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import Head from "next/head";
import Navbar from "@/components/layout/Navbar";
import {
  tagPreview, uploadClothingItem, getTagOptions, correctItem,
  deleteClothingItem, getWardrobeItems,
  TagPreview, TagOptions, ClothingItem,
} from "@/services/api";
import { AlertCircle, Upload, Trash2, ShirtIcon, Loader, CheckCircle, Pencil, X, Pipette } from "lucide-react";
import toast from "react-hot-toast";

// ── Preset solid colors (pattern removed — handled separately) ────────────────
const SOLID_COLORS: { key: string; hex: string; label: string }[] = [
  { key: "black",  hex: "#1a1a1a", label: "Black"  },
  { key: "white",  hex: "#f5f5f0", label: "White"  },
  { key: "navy",   hex: "#1e2f5e", label: "Navy"   },
  { key: "beige",  hex: "#c8a97e", label: "Beige"  },
  { key: "red",    hex: "#c0392b", label: "Red"    },
  { key: "green",  hex: "#4a7c59", label: "Green"  },
  { key: "grey",   hex: "#9e9e9e", label: "Grey"   },
  { key: "brown",  hex: "#7d5a3c", label: "Brown"  },
  { key: "pink",   hex: "#e8a0a0", label: "Pink"   },
  { key: "blue",   hex: "#4a90c4", label: "Blue"   },
  { key: "yellow", hex: "#d4a843", label: "Yellow" },
  { key: "orange", hex: "#d4703a", label: "Orange" },
  { key: "purple", hex: "#7c5cbf", label: "Purple" },
];

// Map key → hex for item card display
const COLOR_HEX: Record<string, string> = Object.fromEntries(
  SOLID_COLORS.map(c => [c.key, c.hex])
);

// ── Pattern definitions with inline SVG renders ───────────────────────────────
const PATTERNS: { key: string; label: string; svg: string }[] = [
  {
    key: "stripes",
    label: "Stripes",
    svg: `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#f0ece4"/>
      <line x1="0" y1="8"  x2="40" y2="8"  stroke="#333" stroke-width="4"/>
      <line x1="0" y1="20" x2="40" y2="20" stroke="#333" stroke-width="4"/>
      <line x1="0" y1="32" x2="40" y2="32" stroke="#333" stroke-width="4"/>
    </svg>`,
  },
  {
    key: "plaid",
    label: "Plaid / Tartan",
    svg: `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#e8d5c4"/>
      <line x1="0" y1="10" x2="40" y2="10" stroke="#8B3A3A" stroke-width="3"/>
      <line x1="0" y1="30" x2="40" y2="30" stroke="#8B3A3A" stroke-width="3"/>
      <line x1="10" y1="0" x2="10" y2="40" stroke="#8B3A3A" stroke-width="3"/>
      <line x1="30" y1="0" x2="30" y2="40" stroke="#8B3A3A" stroke-width="3"/>
      <line x1="0" y1="20" x2="40" y2="20" stroke="#3A5C8B" stroke-width="1.5"/>
      <line x1="20" y1="0" x2="20" y2="40" stroke="#3A5C8B" stroke-width="1.5"/>
    </svg>`,
  },
  {
    key: "floral",
    label: "Floral",
    svg: `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#f5e8f0"/>
      <circle cx="10" cy="10" r="4" fill="#e07090" opacity="0.8"/>
      <circle cx="10" cy="10" r="2" fill="#fff"/>
      <circle cx="30" cy="10" r="3" fill="#c060a0" opacity="0.8"/>
      <circle cx="30" cy="10" r="1.5" fill="#fff"/>
      <circle cx="20" cy="25" r="5" fill="#e07090" opacity="0.7"/>
      <circle cx="20" cy="25" r="2.5" fill="#fff"/>
      <circle cx="8"  cy="32" r="3" fill="#d07898" opacity="0.6"/>
      <circle cx="35" cy="32" r="4" fill="#c060a0" opacity="0.8"/>
      <circle cx="35" cy="32" r="2" fill="#fff"/>
    </svg>`,
  },
  {
    key: "polka_dots",
    label: "Polka Dots",
    svg: `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#f0ece4"/>
      <circle cx="10" cy="10" r="4" fill="#333"/>
      <circle cx="30" cy="10" r="4" fill="#333"/>
      <circle cx="20" cy="22" r="4" fill="#333"/>
      <circle cx="10" cy="34" r="4" fill="#333"/>
      <circle cx="30" cy="34" r="4" fill="#333"/>
    </svg>`,
  },
  {
    key: "animal_print",
    label: "Animal Print",
    svg: `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#e8c87a"/>
      <ellipse cx="10" cy="10" rx="5" ry="3" fill="#6b4c11" opacity="0.7"/>
      <ellipse cx="25" cy="7"  rx="4" ry="2.5" fill="#6b4c11" opacity="0.7"/>
      <ellipse cx="35" cy="18" rx="3" ry="5" fill="#6b4c11" opacity="0.7"/>
      <ellipse cx="15" cy="26" rx="5" ry="3" fill="#6b4c11" opacity="0.7"/>
      <ellipse cx="32" cy="33" rx="4" ry="3" fill="#6b4c11" opacity="0.7"/>
      <ellipse cx="6"  cy="34" rx="3" ry="4" fill="#6b4c11" opacity="0.7"/>
    </svg>`,
  },
  {
    key: "geometric",
    label: "Geometric",
    svg: `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#e8e4dc"/>
      <polygon points="20,2 38,38 2,38" fill="none" stroke="#333" stroke-width="2"/>
      <rect x="8" y="8" width="12" height="12" fill="none" stroke="#999" stroke-width="1.5" transform="rotate(15,14,14)"/>
      <polygon points="26,14 38,14 32,26" fill="#ccc" opacity="0.6"/>
    </svg>`,
  },
  {
    key: "abstract",
    label: "Abstract / Other print",
    svg: `<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" fill="#e4eaf0"/>
      <path d="M5 20 Q15 5 25 20 Q35 35 40 15" stroke="#4a7cb0" stroke-width="3" fill="none"/>
      <path d="M0 30 Q10 15 20 28 Q30 42 40 25" stroke="#b06a4a" stroke-width="2.5" fill="none"/>
      <circle cx="8" cy="8" r="3" fill="#7cb04a" opacity="0.7"/>
      <circle cx="32" cy="32" r="4" fill="#b04a7c" opacity="0.6"/>
    </svg>`,
  },
];

function svgToDataUrl(svg: string) {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}


// ═══════════════════════════════════════════════════════════════════════════════
// Page component
// ═══════════════════════════════════════════════════════════════════════════════

export default function WardrobePage() {
  const [items,      setItems]      = useState<ClothingItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [tagOptions, setTagOptions] = useState<TagOptions>({ categories: [], colors: [], seasons: [], formality_levels: [] });

  // Upload wizard state
  const [pendingFile,    setPendingFile]    = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [aiTags,         setAiTags]         = useState<TagPreview | null>(null);
  const [correctedCat,   setCorrectedCat]   = useState<string>("");
  const [correctedColor, setCorrectedColor] = useState<string>("");  // color key or custom hex
  const [correctedPattern, setCorrectedPattern] = useState<string>("");  // pattern key or ""
  const [hasPattern,     setHasPattern]     = useState(false);
  const [step,           setStep]           = useState<"idle"|"analysing"|"review"|"saving">("idle");
  const [filter,         setFilter]         = useState("all");

  useEffect(() => {
    Promise.all([getWardrobeItems(), getTagOptions()])
      .then(([w, opts]) => { setItems(w); setTagOptions(opts); })
      .catch(() => toast.error("Failed to load wardrobe"))
      .finally(() => setLoading(false));
  }, []);

  const onDrop = useCallback(async (accepted: File[]) => {
    const file = accepted[0];
    if (!file) return;
    setPendingFile(file);
    setPendingPreview(URL.createObjectURL(file));
    setStep("analysing");
    try {
      const tags = await tagPreview(file);
      setAiTags(tags);
      setCorrectedCat(tags.category);
      // If AI returned "pattern" as color, pre-check the pattern toggle
      if (tags.color === "pattern") {
        setCorrectedColor("pattern");
        setHasPattern(true);
        setCorrectedPattern("");
      } else {
        setCorrectedColor(tags.color);
        setHasPattern(false);
        setCorrectedPattern("");
      }
      setStep("review");
    } catch {
      toast.error("AI tagging failed — please try again");
      resetWizard();
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { "image/*": [".jpg",".jpeg",".png",".webp"] },
    multiple: false, disabled: step !== "idle",
  });

  async function handleConfirm() {
    if (!pendingFile || !aiTags) return;
    setStep("saving");
    // Final color value: if pattern toggle is on, use "pattern", else use the color key/hex
    const finalColor = hasPattern ? "pattern" : correctedColor;
    try {
      const newItem = await uploadClothingItem(pendingFile, {
        category: correctedCat  !== aiTags.category ? correctedCat  : undefined,
        color:    finalColor    !== aiTags.color    ? finalColor    : undefined,
        pattern:  hasPattern ? (correctedPattern || undefined) : undefined,
      });
      setItems(prev => [newItem, ...prev]);
      toast.success("Item added to wardrobe!");
    } catch {
      toast.error("Upload failed — please try again");
    } finally { resetWizard(); }
  }

  function resetWizard() {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null); setPendingPreview(null); setAiTags(null);
    setCorrectedCat(""); setCorrectedColor(""); setCorrectedPattern("");
    setHasPattern(false); setStep("idle");
  }

  async function handleCorrect(itemId: string, category: string, color: string) {
    try {
      const updated = await correctItem(itemId, { category, color });
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...updated } : i));
      toast.success("Updated!");
    } catch { toast.error("Could not update item"); }
  }

  async function handleDelete(itemId: string) {
    try {
      await deleteClothingItem(itemId);
      setItems(prev => prev.filter(i => i.id !== itemId));
      toast.success("Item removed");
    } catch { toast.error("Could not remove item"); }
  }

  const categories = ["all", ...Array.from(new Set(items.map(i => i.category)))];
  const visible    = filter === "all" ? items : items.filter(i => i.category === filter);

  return (
    <>
      <Head><title>Wardrobe — LuxeLook AI</title></Head>
      <Navbar />
      <main style={{ maxWidth: "1200px", margin: "0 auto", padding: "48px 24px" }}>

        <div style={{ marginBottom: "36px" }}>
          <h1 style={{ fontSize: "36px", marginBottom: "8px" }}>My Wardrobe</h1>
          <p style={{ color: "var(--muted)", fontSize: "15px" }}>
            {items.length} item{items.length !== 1 ? "s" : ""} · AI detects category &amp; color · you confirm before saving
          </p>
        </div>

        {step === "idle" && (
          <div {...getRootProps()} className={`dropzone ${isDragActive ? "active" : ""}`} style={{ marginBottom: "32px" }}>
            <input {...getInputProps()} />
            <Upload size={28} color="var(--gold)" />
            <p style={{ fontWeight: 500, color: "var(--charcoal)", marginTop: "8px" }}>
              {isDragActive ? "Drop your image here" : "Drag & drop a clothing photo"}
            </p>
            <p style={{ color: "var(--muted)", fontSize: "13px", marginTop: "4px" }}>
              or click to browse · one at a time
            </p>
          </div>
        )}

        {step === "analysing" && pendingPreview && (
          <div className="card fade-up" style={{ display: "flex", gap: "20px", padding: "24px", marginBottom: "32px", alignItems: "center" }}>
            <img src={pendingPreview} style={{ width: "90px", height: "120px", objectFit: "cover", borderRadius: "8px" }} alt="" />
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                <Loader size={18} color="var(--gold)" style={{ animation: "spin 1s linear infinite" }} />
                <p style={{ fontWeight: 600 }}>AI is analysing your item…</p>
              </div>
              <p style={{ color: "var(--muted)", fontSize: "14px" }}>Detecting category and colour</p>
            </div>
          </div>
        )}

        {step === "review" && aiTags && pendingPreview && (
          <ReviewPanel
            previewUrl={pendingPreview}
            aiTags={aiTags}
            tagOptions={tagOptions}
            correctedCat={correctedCat}
            correctedColor={correctedColor}
            hasPattern={hasPattern}
            correctedPattern={correctedPattern}
            onCatChange={setCorrectedCat}
            onColorChange={setCorrectedColor}
            onPatternToggle={setHasPattern}
            onPatternChange={setCorrectedPattern}
            onConfirm={handleConfirm}
            onCancel={resetWizard}
          />
        )}

        {step === "saving" && (
          <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
            <Loader size={28} color="var(--gold)" style={{ animation: "spin 1s linear infinite", display: "block", margin: "0 auto 12px" }} />
            Saving to your wardrobe…
          </div>
        )}

        {items.length > 0 && (
          <div style={{ display: "flex", gap: "8px", marginBottom: "24px", flexWrap: "wrap" }}>
            {categories.map(cat => (
              <button key={cat} onClick={() => setFilter(cat)} style={{
                padding: "6px 16px", borderRadius: "20px", border: "1px solid",
                borderColor: filter === cat ? "var(--charcoal)" : "var(--border)",
                background:  filter === cat ? "var(--charcoal)" : "transparent",
                color:       filter === cat ? "var(--cream)"    : "var(--muted)",
                fontSize: "13px", fontWeight: 500, cursor: "pointer",
                textTransform: "capitalize", transition: "all 0.15s ease",
              }}>{cat}</button>
            ))}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: "60px" }}>
            <Loader size={32} color="var(--gold)" style={{ animation: "spin 1s linear infinite" }} />
          </div>
        ) : visible.length === 0 && step === "idle" ? (
          <EmptyState />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "20px" }}>
            {visible.map(item => (
              <ItemCard key={item.id} item={item} tagOptions={tagOptions}
                onDelete={() => handleDelete(item.id)}
                onCorrect={(cat, color) => handleCorrect(item.id, cat, color)}
              />
            ))}
          </div>
        )}
      </main>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ReviewPanel
// ═══════════════════════════════════════════════════════════════════════════════

function ReviewPanel({
  previewUrl, aiTags, tagOptions,
  correctedCat, correctedColor, hasPattern, correctedPattern,
  onCatChange, onColorChange, onPatternToggle, onPatternChange,
  onConfirm, onCancel,
}: {
  previewUrl: string;
  aiTags: TagPreview;
  tagOptions: TagOptions;
  correctedCat: string;
  correctedColor: string;
  hasPattern: boolean;
  correctedPattern: string;
  onCatChange: (v: string) => void;
  onColorChange: (v: string) => void;
  onPatternToggle: (v: boolean) => void;
  onPatternChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const catChanged   = correctedCat   !== aiTags.category;
  const colorChanged = (hasPattern ? "pattern" : correctedColor) !== aiTags.color;
  const aiUnavailable = !!aiTags.needs_review;

  return (
    <div className="card fade-up" style={{ marginBottom: "32px", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ fontWeight: 600, fontSize: "15px", color: "var(--charcoal)" }}>Review AI tags</p>
          <p style={{ color: "var(--muted)", fontSize: "13px" }}>Correct category or colour if needed, then confirm</p>
        </div>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}>
          <X size={18} />
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap" }}>
        {/* Clickable image for eyedropper */}
        <ImageEyedropper
          previewUrl={previewUrl}
          onColorPicked={onColorChange}
          onPatternToggle={onPatternToggle}
        />

        {/* Fields */}
        <div style={{ flex: 1, padding: "20px", minWidth: "300px" }}>

          {aiUnavailable && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", background: "#FFF8E7", border: "1px solid #F0D080", borderRadius: "8px", padding: "10px 12px", marginBottom: "16px" }}>
              <AlertCircle size={15} color="#B8860B" style={{ flexShrink: 0, marginTop: "1px" }} />
              <p style={{ fontSize: "13px", color: "#7A5C00", lineHeight: 1.4 }}>
                AI couldn't analyse this image — defaults pre-filled. Please review before saving.
              </p>
            </div>
          )}

          {/* Category */}
          <div style={{ marginBottom: "20px" }}>
            <label style={labelStyle}>Category {catChanged && <ChangedBadge />}</label>
            <select value={correctedCat} onChange={e => onCatChange(e.target.value)}
              className="input" style={{ padding: "8px 12px", fontSize: "14px", textTransform: "capitalize" }}>
              {tagOptions.categories.map(c => (
                <option key={c} value={c} style={{ textTransform: "capitalize" }}>{c}</option>
              ))}
            </select>
            {catChanged && <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px" }}>AI said: <em style={{ textTransform: "capitalize" }}>{aiTags.category}</em></p>}
          </div>

          {/* Color */}
          <div style={{ marginBottom: "20px" }}>
            <label style={labelStyle}>Colour {colorChanged && <ChangedBadge />}</label>
            <ColorPicker
              selected={hasPattern ? "pattern" : correctedColor}
              onSelect={key => { onColorChange(key); if (key !== "pattern") onPatternToggle(false); }}
            />
            {colorChanged && <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px" }}>AI said: <em style={{ textTransform: "capitalize" }}>{aiTags.color}</em></p>}
          </div>

          {/* Pattern toggle + picker */}
          <div style={{ marginBottom: "20px" }}>
            <label style={labelStyle}>Pattern</label>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
              <button
                onClick={() => { onPatternToggle(!hasPattern); if (!hasPattern) onColorChange("pattern"); }}
                style={{
                  padding: "6px 16px", borderRadius: "20px", border: "1px solid",
                  borderColor: hasPattern ? "var(--charcoal)" : "var(--border)",
                  background:  hasPattern ? "var(--charcoal)" : "transparent",
                  color:       hasPattern ? "var(--cream)"    : "var(--muted)",
                  fontSize: "13px", cursor: "pointer", transition: "all 0.15s ease",
                }}
              >
                {hasPattern ? "✓ Has a pattern" : "Has a pattern"}
              </button>
            </div>

            {hasPattern && (
              <PatternPicker selected={correctedPattern} onSelect={onPatternChange} />
            )}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "10px" }}>
            <button className="btn-primary" onClick={onConfirm} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <CheckCircle size={15} /> Confirm &amp; Save
            </button>
            <button className="btn-secondary" onClick={onCancel} style={{ fontSize: "13px" }}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ImageEyedropper — click anywhere on the preview image to sample its color
// ═══════════════════════════════════════════════════════════════════════════════

function ImageEyedropper({ previewUrl, onColorPicked, onPatternToggle }: {
  previewUrl: string;
  onColorPicked: (hex: string) => void;
  onPatternToggle: (v: boolean) => void;
}) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const [ready,    setReady]    = useState(false);
  const [eyedrop,  setEyedrop]  = useState(false);
  const [pickedHex, setPickedHex] = useState<string | null>(null);

  // Draw the image onto the hidden canvas once loaded
  function handleImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img    = e.currentTarget;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) { ctx.drawImage(img, 0, 0); setReady(true); }
  }

  function handleImageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!eyedrop || !ready || !canvasRef.current) return;
    const rect   = e.currentTarget.getBoundingClientRect();
    const scaleX = canvasRef.current.width  / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top)  * scaleY);
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    const hex = `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
    setPickedHex(hex);
    onColorPicked(hex);          // pass custom hex directly as the color value
    onPatternToggle(false);      // custom hex means solid color, not pattern
    setEyedrop(false);
    toast.success("Colour sampled!");
  }

  return (
    <div style={{ width: "160px", flexShrink: 0, position: "relative" }}>
      <div
        onClick={handleImageClick}
        style={{ cursor: eyedrop ? "crosshair" : "default", position: "relative" }}
      >
        <img
          src={previewUrl}
          alt="Preview"
          crossOrigin="anonymous"
          onLoad={handleImgLoad}
          style={{ width: "160px", height: "220px", objectFit: "cover", display: "block" }}
        />
        {eyedrop && (
          <div style={{
            position: "absolute", inset: 0,
            background: "rgba(201,168,76,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ background: "rgba(0,0,0,0.6)", borderRadius: "8px", padding: "6px 10px", color: "white", fontSize: "12px", textAlign: "center" }}>
              <Pipette size={16} style={{ display: "block", margin: "0 auto 4px" }} />
              Click to sample
            </div>
          </div>
        )}
      </div>

      {/* Hidden canvas for pixel sampling */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Eyedropper toggle button */}
      <button
        onClick={() => setEyedrop(v => !v)}
        title="Pick colour from image"
        style={{
          position: "absolute", bottom: "8px", right: "8px",
          background: eyedrop ? "var(--gold)" : "rgba(255,255,255,0.9)",
          border: "none", borderRadius: "6px", padding: "6px",
          cursor: "pointer", display: "flex", alignItems: "center",
          boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
        }}
      >
        <Pipette size={16} color={eyedrop ? "white" : "var(--charcoal)"} />
      </button>

      {/* Show sampled hex swatch */}
      {pickedHex && (
        <div style={{ padding: "6px 8px", background: "var(--surface)", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ width: "14px", height: "14px", borderRadius: "3px", background: pickedHex, border: "1px solid var(--border)", flexShrink: 0 }} />
          <span style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "monospace" }}>{pickedHex}</span>
        </div>
      )}

      <p style={{ fontSize: "11px", color: "var(--muted)", textAlign: "center", padding: "4px 0 0", lineHeight: 1.3 }}>
        Click <Pipette size={10} style={{ display: "inline", verticalAlign: "middle" }} /> to sample a pixel
      </p>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ColorPicker — preset swatches + custom hex input
// ═══════════════════════════════════════════════════════════════════════════════

function ColorPicker({ selected, onSelect }: { selected: string; onSelect: (key: string) => void }) {
  const [customHex, setCustomHex] = useState("");

  // Determine if selected is a preset key or a custom hex
  const isPreset  = SOLID_COLORS.some(c => c.key === selected);
  const isCustom  = selected.startsWith("#") && !isPreset;
  const isPattern = selected === "pattern";

  const displayLabel = isPreset
    ? SOLID_COLORS.find(c => c.key === selected)?.label
    : isPattern ? "Pattern"
    : isCustom  ? selected
    : selected;

  return (
    <div>
      {/* Preset swatches */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
        {SOLID_COLORS.map(c => (
          <button key={c.key} title={c.label} onClick={() => onSelect(c.key)} style={{
            width: "28px", height: "28px", borderRadius: "50%",
            background: c.hex,
            border: selected === c.key ? "3px solid var(--charcoal)" : "2px solid transparent",
            outline: selected === c.key ? "2px solid var(--cream)" : "none",
            cursor: "pointer", transition: "transform 0.1s ease",
            transform: selected === c.key ? "scale(1.15)" : "scale(1)",
          }} />
        ))}
      </div>

      {/* Custom hex input */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <input
          type="color"
          value={isCustom ? selected : "#ffffff"}
          onChange={e => { setCustomHex(e.target.value); onSelect(e.target.value); }}
          title="Pick a custom colour"
          style={{ width: "32px", height: "32px", border: "1px solid var(--border)", borderRadius: "6px", cursor: "pointer", padding: "2px" }}
        />
        <input
          type="text"
          value={isCustom ? selected : customHex}
          placeholder="#hex or type colour"
          onChange={e => { const v = e.target.value; setCustomHex(v); if (/^#[0-9a-f]{6}$/i.test(v)) onSelect(v); }}
          style={{ flex: 1, padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "13px", fontFamily: "monospace" }}
        />
      </div>

      {/* Selected label */}
      <p style={{ fontSize: "12px", color: "var(--muted)", marginTop: "6px", textTransform: isCustom ? "none" : "capitalize" }}>
        Selected: <strong style={{ color: "var(--ink)" }}>{displayLabel}</strong>
        {isCustom && <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "3px", background: selected, border: "1px solid var(--border)", marginLeft: "6px", verticalAlign: "middle" }} />}
      </p>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// PatternPicker — dropdown with name + inline SVG swatch
// ═══════════════════════════════════════════════════════════════════════════════

function PatternPicker({ selected, onSelect }: { selected: string; onSelect: (k: string) => void }) {
  const current = PATTERNS.find(p => p.key === selected) || null;

  return (
    <div>
      {/* Current selection preview */}
      {current && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", background: "var(--surface)", borderRadius: "8px", marginBottom: "10px", border: "1px solid var(--border)" }}>
          <img src={svgToDataUrl(current.svg)} width={36} height={36} style={{ borderRadius: "4px" }} alt={current.label} />
          <span style={{ fontWeight: 500, fontSize: "14px" }}>{current.label}</span>
        </div>
      )}

      {/* Pattern options grid */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {PATTERNS.map(p => (
          <button key={p.key} onClick={() => onSelect(p.key)} style={{
            display: "flex", alignItems: "center", gap: "12px",
            padding: "8px 10px", borderRadius: "8px", border: "1px solid",
            borderColor: selected === p.key ? "var(--charcoal)" : "var(--border)",
            background:  selected === p.key ? "#f5f0e8"         : "white",
            cursor: "pointer", textAlign: "left", transition: "all 0.12s ease",
          }}>
            <img src={svgToDataUrl(p.svg)} width={32} height={32} style={{ borderRadius: "4px", flexShrink: 0 }} alt={p.label} />
            <span style={{ fontSize: "13px", fontWeight: selected === p.key ? 600 : 400, color: "var(--ink)" }}>{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ItemCard with inline edit (category + color only — no season/formality)
// ═══════════════════════════════════════════════════════════════════════════════

function ItemCard({ item, tagOptions, onDelete, onCorrect }: {
  item: ClothingItem;
  tagOptions: TagOptions;
  onDelete: () => void;
  onCorrect: (cat: string, color: string) => void;
}) {
  const [editing,   setEditing]   = useState(false);
  const [editCat,   setEditCat]   = useState(item.category);
  const [editColor, setEditColor] = useState(item.color || "");

  const formalityLabel =
    item.formality_score !== undefined
      ? item.formality_score >= 0.75 ? "Formal"
      : item.formality_score >= 0.50 ? "Smart casual"
      : item.formality_score >= 0.25 ? "Casual"
      : "Loungewear"
      : null;

  // Resolve display color: preset key → hex, custom hex → use directly, pattern → gradient
  const colorDisplay = COLOR_HEX[editColor]
    ?? (editColor === "pattern" ? "linear-gradient(135deg,#e8a0a0 25%,#4a90c4 75%)" : undefined)
    ?? (editColor.startsWith("#") ? editColor : "#ccc");

  return (
    <div className="card" style={{ overflow: "hidden", position: "relative" }}>
      <div style={{ aspectRatio: "3/4", overflow: "hidden", background: "var(--surface)", position: "relative" }}>
        <img src={item.image_url} alt={`${item.color} ${item.category}`}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={e => { (e.target as HTMLImageElement).src = `https://placehold.co/300x400/F5F0E8/8A8580?text=${encodeURIComponent(item.category)}`; }}
        />
        <div className="card-actions" style={{ position: "absolute", top: "8px", right: "8px", display: "flex", flexDirection: "column", gap: "4px", opacity: 0, transition: "opacity 0.2s ease" }}>
          <ActionBtn onClick={() => { setEditing(e => !e); setEditCat(item.category); setEditColor(item.color || ""); }} icon={<Pencil size={13} />} />
          <ActionBtn onClick={onDelete} icon={<Trash2 size={13} color="#DC2626" />} />
        </div>
      </div>

      {!editing && (
        <div style={{ padding: "12px" }}>
          <p style={{ fontWeight: 500, fontSize: "14px", textTransform: "capitalize", marginBottom: "4px" }}>
            <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: colorDisplay, marginRight: "6px", verticalAlign: "middle", border: "1px solid var(--border)" }} />
            {item.color} {item.category}
          </p>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {item.season && <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "capitalize" }}>{item.season}</span>}
            {formalityLabel && (
              <span className="formality-pill" style={{
                background: (item.formality_score||0) > 0.6 ? "#1C191720" : "#8B9E7E22",
                color:      (item.formality_score||0) > 0.6 ? "var(--charcoal)" : "var(--sage)",
              }}>{formalityLabel}</span>
            )}
          </div>
        </div>
      )}

      {editing && (
        <div style={{ padding: "12px", background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
          <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>Edit tags</p>

          <label style={{ fontSize: "11px", color: "var(--muted)", display: "block", marginBottom: "4px" }}>Category</label>
          <select value={editCat} onChange={e => setEditCat(e.target.value)}
            style={{ width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "13px", marginBottom: "12px", textTransform: "capitalize", background: "white" }}>
            {tagOptions.categories.map(c => <option key={c} value={c} style={{ textTransform: "capitalize" }}>{c}</option>)}
          </select>

          <label style={{ fontSize: "11px", color: "var(--muted)", display: "block", marginBottom: "6px" }}>Colour</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "8px" }}>
            {SOLID_COLORS.map(c => (
              <button key={c.key} title={c.label} onClick={() => setEditColor(c.key)} style={{
                width: "22px", height: "22px", borderRadius: "50%", background: c.hex,
                border: editColor === c.key ? "3px solid var(--charcoal)" : "2px solid transparent",
                cursor: "pointer",
              }} />
            ))}
          </div>
          {/* Mini custom colour input for card edit */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
            <input type="color" value={editColor.startsWith("#") ? editColor : "#ffffff"}
              onChange={e => setEditColor(e.target.value)}
              style={{ width: "28px", height: "28px", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer", padding: "2px" }} />
            <span style={{ fontSize: "11px", color: "var(--muted)" }}>or pick custom</span>
          </div>

          <div style={{ display: "flex", gap: "6px" }}>
            <button onClick={() => { onCorrect(editCat, editColor); setEditing(false); }}
              className="btn-primary" style={{ padding: "6px 14px", fontSize: "12px" }}>Save</button>
            <button onClick={() => setEditing(false)}
              className="btn-secondary" style={{ padding: "6px 14px", fontSize: "12px" }}>Cancel</button>
          </div>
        </div>
      )}

      <style>{`.card:hover .card-actions { opacity: 1 !important; }`}</style>
    </div>
  );
}


// ── Tiny helpers ──────────────────────────────────────────────────────────────

function ActionBtn({ onClick, icon }: { onClick: () => void; icon: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ background: "rgba(255,255,255,0.92)", border: "none", borderRadius: "6px", padding: "6px", cursor: "pointer", display: "flex", alignItems: "center" }}>
      {icon}
    </button>
  );
}

function ChangedBadge() {
  return <span style={{ marginLeft: "6px", fontSize: "10px", color: "var(--gold)", fontWeight: 600, letterSpacing: "0.05em" }}>EDITED</span>;
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "11px", fontWeight: 600,
  color: "var(--muted)", textTransform: "uppercase",
  letterSpacing: "0.07em", marginBottom: "6px",
};

function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "80px 24px", color: "var(--muted)" }}>
      <ShirtIcon size={48} color="var(--border)" style={{ margin: "0 auto 16px", display: "block" }} />
      <h3 style={{ fontFamily: "Playfair Display, serif", color: "var(--charcoal)", marginBottom: "8px" }}>Your wardrobe is empty</h3>
      <p style={{ fontSize: "15px" }}>Upload your first clothing item to get started</p>
    </div>
  );
}
