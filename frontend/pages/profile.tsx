/**
 * pages/profile.tsx — User profile page
 * - Body type: inline calculator with scored matching, top-2 on borderline
 * - Complexion: inline 3-question guide, slash notation on ambiguous result
 * - AI profiling photo: separate analysis image for face/body/complexion/hair suggestions
 * - Height: cm / in toggle, stores cm
 * - Weight: kg / lbs toggle, stores kg
 * - Photo: uploads a cropped display avatar only
 */

import { useEffect, useRef, useState } from "react";
import Head from "next/head";
import Image from "next/image";
import Navbar from "@/components/layout/Navbar";
import { FaceShapeTool } from "@/components/FaceShapeTool";
import { PhotoCropper } from "@/components/PhotoCropper";
import {
  AIProfileAnalysis,
  ProfileTraitAnalysis,
  getProfile,
  updateProfile,
  uploadAIProfilePhoto,
  uploadProfilePhoto,
  UserProfile,
} from "@/services/api";
import { User, ChevronDown, ChevronUp, Camera, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";

// ── Static data ───────────────────────────────────────────────────────────────

const BODY_TYPES  = ["hourglass", "pear", "apple", "rectangle", "inverted triangle"];
const COMPLEXIONS = ["fair", "light", "medium", "olive", "tan", "deep"];
const FACE_SHAPES = ["oval", "round", "square", "heart", "diamond", "oblong"];
const HAIR_TEXTURE = ["straight", "wavy", "curly", "coily"];
const HAIR_LENGTH  = ["short", "medium", "long"];
const AGE_RANGES  = ["under 18", "18–24", "25–34", "35–44", "45–54", "55+"];
const ALLOWED_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"];

function shouldBypassImageOptimization(src: string): boolean {
  return src.startsWith("blob:") || src.startsWith("data:");
}

const BODY_TYPE_GUIDE: Record<string, { desc: string; hint: string }> = {
  hourglass:           { desc: "Bust and hips roughly equal width, waist noticeably narrower", hint: "Bust ≈ Hip, Waist 25%+ smaller than Bust" },
  pear:                { desc: "Hips wider than bust, narrower shoulders", hint: "Hip > Bust by 5%+" },
  apple:               { desc: "Fuller midsection, weight carried around the waist", hint: "Waist close to or wider than Bust" },
  rectangle:           { desc: "Bust, waist and hips similar width, straight silhouette", hint: "All three within 5% of each other" },
  "inverted triangle": { desc: "Shoulders and bust wider than hips", hint: "Bust > Hip by 5%+" },
};

const COMPLEXION_GUIDE: Record<string, { desc: string; undertone: string }> = {
  fair:   { desc: "Very light skin, burns easily, often rosy or pink", undertone: "Cool" },
  light:  { desc: "Light skin, may tan slightly, peachy or pink tones", undertone: "Cool / Neutral" },
  medium: { desc: "Beige tone, tans moderately, warm or neutral cast", undertone: "Neutral / Warm" },
  olive:  { desc: "Greenish or yellowish undertone, tans easily", undertone: "Warm" },
  tan:    { desc: "Medium-brown, tans easily, golden warm undertones", undertone: "Warm" },
  deep:   { desc: "Dark brown to ebony, rich undertones (cool, warm or neutral)", undertone: "Varies" },
};

const FACE_SHAPE_GUIDE: Record<string, { desc: string; styles: string }> = {
  oval:    { desc: "Balanced proportions, slightly wider at cheekbones, gentle taper to jaw", styles: "Most styles work well — considered the ideal balanced shape" },
  round:   { desc: "Similar width and length, full cheeks, rounded jaw", styles: "Angular frames, V-necks, and structured pieces add definition" },
  square:  { desc: "Strong jaw, forehead and jaw similar width, angular features", styles: "Soft layers, round necklines, and draped fabrics soften the angles" },
  heart:   { desc: "Wider forehead tapering to a narrow, pointed chin", styles: "Wide-leg bottoms and A-line skirts balance the upper half" },
  diamond: { desc: "Narrow forehead and jaw, wide cheekbones", styles: "Off-shoulder and wide necklines balance the cheekbones" },
  oblong:  { desc: "Longer than wide, forehead, cheeks and jaw similar width", styles: "Horizontal details and wide necklines add width" },
};

// ── Body type scoring ─────────────────────────────────────────────────────────

interface CalcResult {
  result: string;
  confidence: "high" | "medium";
  runner?: string;
  note?: string;
}

function calcBodyType(bust: number, waist: number, hip: number): CalcResult | null {
  // Basic validity
  if (bust <= 0 || waist <= 0 || hip <= 0) return null;
  // Sanity: ratio between largest and smallest shouldn't exceed 2.5 (catches unit errors)
  const max = Math.max(bust, waist, hip);
  const min = Math.min(bust, waist, hip);
  if (max / min > 2.5) return null;
  // Minimum plausible measurement (catches accidental single-digit entries in cm)
  if (Math.min(bust, waist, hip) < 20) return null;

  const scores: Record<string, number> = {
    hourglass: 0, pear: 0, apple: 0,
    rectangle: 0, "inverted triangle": 0,
  };

  const wbRatio = waist / bust;
  const hbRatio = hip  / bust;
  const bhRatio = bust / hip;

  // Hourglass: bust ≈ hip, waist significantly smaller
  scores.hourglass = (1 - Math.abs(bust - hip) / bust) * 0.6
    + Math.max(0, 0.75 - wbRatio) * 0.4;

  // Pear: hip notably larger
  scores.pear = Math.max(0, hbRatio - 1.0) * 2.5;

  // Apple: waist close to or exceeds bust
  scores.apple = Math.max(0, wbRatio - 0.80) * 2.5;

  // Rectangle: low spread across all three
  const spread = Math.max(
    Math.abs(bust - waist) / bust,
    Math.abs(bust - hip)   / bust,
    Math.abs(waist - hip)  / bust,
  );
  scores.rectangle = Math.max(0, 0.18 - spread) * 8;

  // Inverted triangle: bust wider than hip
  scores["inverted triangle"] = Math.max(0, bhRatio - 1.05) * 2.5;

  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .filter(e => e[1] > 0);

  if (!sorted.length || sorted[0][1] === 0) return null;

  const [first, second] = sorted;
  const gap = first[1] - (second?.[1] ?? 0);

  if (gap > 0.25 || !second) {
    return { result: first[0], confidence: "high" };
  }
  return {
    result: first[0],
    confidence: "medium",
    runner: second[0],
    note: "Your measurements fall between two types — pick whichever feels right",
  };
}

// ── Complexion scoring ────────────────────────────────────────────────────────

interface ComplexionResult {
  result: string;
  runner?: string;
  display: string; // e.g. "medium" or "medium / olive"
}

function calcComplexion(vein: string, sun: string, depth: string): ComplexionResult {
  const scores: Record<string, number> = {
    fair: 0, light: 0, medium: 0, olive: 0, tan: 0, deep: 0,
  };

  // Depth — strongest signal (weight 3)
  if (depth === "light") {
    if (vein === "blue-purple") scores.fair  += 3;
    if (vein === "blue-green")  scores.light += 3;
    if (vein === "green")       scores.light += 2;
    if (vein === "blue-purple" || vein === "blue-green") scores.light += 1;
  } else if (depth === "medium") {
    if (vein === "green")      scores.olive  += 3;
    if (vein === "blue-green") { scores.medium += 2; scores.olive += 1; }
    if (vein === "blue-purple") scores.medium += 3;
  } else { // deep
    if (vein === "blue-purple") scores.deep += 3;
    if (vein === "green")       scores.tan  += 3;
    if (vein === "blue-green")  { scores.tan += 2; scores.deep += 1; }
  }

  // Sun reaction — secondary signal (weight 2)
  if (sun === "burns")  { scores.fair += 2; scores.light += 1; }
  if (sun === "tans")   { scores.medium += 1; scores.olive += 1; scores.tan += 1; }
  if (sun === "rarely") { scores.tan += 1; scores.deep += 2; }

  const sorted = Object.entries(scores)
    .filter(e => e[1] > 0)
    .sort((a, b) => b[1] - a[1]);

  if (!sorted.length) return { result: "medium", display: "medium" };

  const [first, second] = sorted;
  const gap = first[1] - (second?.[1] ?? 0);

  if (gap <= 1 && second) {
    return {
      result: first[0],
      runner: second[0],
      display: `${first[0]} / ${second[0]}`,
    };
  }
  return { result: first[0], display: first[0] };
}

// ── Sub-components ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "11px", fontWeight: 600,
  color: "var(--muted)", textTransform: "uppercase",
  letterSpacing: "0.07em", marginBottom: "6px",
};

function SelectField({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="input"
      style={{ padding: "10px 12px", fontSize: "14px", textTransform: "capitalize", width: "100%" }}>
      <option value="">Select…</option>
      {options.map(o => <option key={o} value={o} style={{ textTransform: "capitalize" }}>{o}</option>)}
    </select>
  );
}

function UnitToggle({ value, options, onChange }: {
  value: string; options: [string, string]; onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
      {options.map(opt => (
        <button key={opt} onClick={() => onChange(opt)}
          style={{
            padding: "4px 12px", fontSize: "12px", border: "none", cursor: "pointer",
            background: value === opt ? "var(--charcoal)" : "transparent",
            color: value === opt ? "#0A0908" : "var(--muted)",
            fontWeight: value === opt ? 600 : 400,
            transition: "background 0.15s",
          }}>
          {opt}
        </button>
      ))}
    </div>
  );
}

function GuideCard({ title, rows }: {
  title: string;
  rows: { label: string; desc: string; extra?: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: "10px", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
      <button onClick={() => setOpen(p => !p)}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "10px 14px", background: "var(--surface)", border: "none", cursor: "pointer" }}>
        <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 600 }}>{title}</span>
        {open
          ? <ChevronUp  size={14} color="var(--muted)" />
          : <ChevronDown size={14} color="var(--muted)" />}
      </button>
      {open && (
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {rows.map(r => (
            <div key={r.label} style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: "12px", alignItems: "start" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--charcoal)", textTransform: "capitalize" }}>{r.label}</span>
              <div>
                <p style={{ fontSize: "13px", color: "var(--ink)", margin: 0 }}>{r.desc}</p>
                {r.extra && <p style={{ fontSize: "12px", color: "var(--muted)", margin: "2px 0 0" }}>{r.extra}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CalcLinkButton({ label, open, onClick }: { label: string; open: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{ fontSize: "12px", color: "var(--gold)", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
      {open ? "Close" : label}
    </button>
  );
}

function InlinePanel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: "12px", padding: "16px", background: "var(--surface)",
      borderRadius: "8px", border: "1px solid var(--border)" }}>
      {children}
    </div>
  );
}

function ChipGroup({ options, value, onChange }: {
  options: [string, string][]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
      {options.map(([val, label]) => (
        <button key={val} onClick={() => onChange(val)}
          style={{
            padding: "6px 14px", fontSize: "13px", borderRadius: "20px", cursor: "pointer",
            border: `1px solid ${value === val ? "var(--charcoal)" : "var(--border)"}`,
            background: value === val ? "var(--gold)" : "var(--surface)",
            color: value === val ? "#0A0908" : "var(--muted)",
            transition: "all 0.15s",
          }}>
          {label}
        </button>
      ))}
    </div>
  );
}

function ResultRow({ label, sublabel, note, onUse, onUseAlt, altLabel }: {
  label: string; sublabel?: string; note?: string;
  onUse: () => void; onUseAlt?: () => void; altLabel?: string;
}) {
  return (
    <div style={{ marginTop: "10px", padding: "12px 14px", background: "var(--surface)",
      borderRadius: "6px", border: "1px solid var(--border)", display: "flex",
      justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--charcoal)",
          textTransform: "capitalize", margin: 0 }}>
          {label}
        </p>
        {sublabel && <p style={{ fontSize: "12px", color: "var(--muted)", margin: "2px 0 0" }}>{sublabel}</p>}
        {note && (
          <p style={{ fontSize: "11px", color: "var(--gold)", margin: "4px 0 0",
            display: "flex", alignItems: "center", gap: "4px" }}>
            <AlertCircle size={10} /> {note}
          </p>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", flexShrink: 0 }}>
        <button onClick={onUse}
          style={{ fontSize: "12px", fontWeight: 600, color: "var(--gold)",
            background: "none", border: "1px solid var(--gold)",
            borderRadius: "4px", padding: "4px 10px", cursor: "pointer", textTransform: "capitalize" }}>
          Use {label.split(" / ")[0]}
        </button>
        {onUseAlt && altLabel && (
          <button onClick={onUseAlt}
            style={{ fontSize: "12px", color: "var(--muted)",
              background: "none", border: "1px solid var(--border)",
              borderRadius: "4px", padding: "4px 10px", cursor: "pointer", textTransform: "capitalize" }}>
            Use {altLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function TraitCard({
  label,
  trait,
  currentValue,
  onApply,
}: {
  label: string;
  trait: ProfileTraitAnalysis;
  currentValue?: string;
  onApply?: () => void;
}) {
  const hasValue = !!trait.value;
  const showApply = !!trait.value && trait.value !== currentValue && trait.confidence !== "low" && !!onApply;

  return (
    <div style={{
      padding: "12px 14px",
      borderRadius: "8px",
      border: "1px solid var(--border)",
      background: "var(--surface)",
      display: "flex",
      justifyContent: "space-between",
      gap: "12px",
      alignItems: "flex-start",
    }}>
      <div style={{ flex: 1 }}>
        <p className="type-helper" style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 600, margin: 0 }}>{label}</p>
        <p className="type-body" style={{ fontSize: "14px", color: "var(--charcoal)", fontWeight: 600, margin: "4px 0 0", textTransform: "capitalize" }}>
          {hasValue ? trait.value : "No suggestion yet"}
        </p>
        <p className="type-helper" style={{ fontSize: "12px", color: "var(--muted)", margin: "4px 0 0" }}>
          {trait.reason || "Upload a clearer AI profiling photo to improve this signal."}
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-end", flexShrink: 0 }}>
        <span className="type-micro" style={{
          fontSize: "11px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: trait.confidence === "high" ? "var(--sage)" : trait.confidence === "medium" ? "var(--gold)" : "var(--muted)",
        }}>
          {trait.confidence}
        </span>
        {showApply && (
          <button
            onClick={onApply}
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--gold)",
              background: "none",
              border: "1px solid var(--gold)",
              borderRadius: "4px",
              padding: "4px 10px",
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            Apply
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const [profile,        setProfile]        = useState<UserProfile | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [saving,         setSaving]         = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [aiPhotoUploading, setAiPhotoUploading] = useState(false);
  const [cropFile,         setCropFile]         = useState<File | null>(null);
  const [photoPreview,     setPhotoPreview]     = useState<string | null>(null);
  const [aiPhotoPreview,   setAiPhotoPreview]   = useState<string | null>(null);
  const [profileAnalysis,  setProfileAnalysis]  = useState<AIProfileAnalysis | null>(null);
  const [showFaceTool,     setShowFaceTool]     = useState(false);
  const [showAIProfiling,  setShowAIProfiling]  = useState(false);
  const profilePhotoInputRef = useRef<HTMLInputElement>(null);
  const aiPhotoInputRef = useRef<HTMLInputElement>(null);

  // Core form state
  const [bodyType,    setBodyType]    = useState("");
  const [ageRange,    setAgeRange]    = useState("");
  const [heightVal,   setHeightVal]   = useState("");
  const [heightUnit,  setHeightUnit]  = useState<"cm" | "in">("cm");
  const [weightVal,   setWeightVal]   = useState("");
  const [weightUnit,  setWeightUnit]  = useState<"kg" | "lbs">("kg");
  const [complexion,  setComplexion]  = useState("");
  const [faceShape,   setFaceShape]   = useState("");
  const [hairTexture, setHairTexture] = useState("");
  const [hairLength,  setHairLength]  = useState("");

  // Panel open states
  const [showBodyCalc,    setShowBodyCalc]    = useState(false);
  const [showComplexCalc, setShowComplexCalc] = useState(false);

  // Body type calculator state
  const [bust,  setBust]  = useState("");
  const [waist, setWaist] = useState("");
  const [hip,   setHip]   = useState("");

  // Complexion calculator state
  const [vein,  setVein]  = useState("");
  const [sun,   setSun]   = useState("");
  const [depth, setDepth] = useState("");

  // Derived results
  const bodyResult = (bust && waist && hip)
    ? calcBodyType(parseFloat(bust), parseFloat(waist), parseFloat(hip))
    : null;

  const complexResult = (vein && sun && depth)
    ? calcComplexion(vein, sun, depth)
    : null;

  function syncProfileState(p: UserProfile) {
    setProfile(p);
    setBodyType(p.body_type || "");
    setAgeRange(p.age_range || "");
    setComplexion(p.complexion || "");
    setFaceShape(p.face_shape || "");

    const parts = (p.hairstyle || "").split(",").map(s => s.trim());
    setHairTexture(parts.find(part => HAIR_TEXTURE.includes(part)) || "");
    setHairLength(parts.find(part => HAIR_LENGTH.includes(part)) || "");

    setPhotoPreview(p.photo_url || null);
    setAiPhotoPreview(p.ai_profile_photo_url || null);
    setProfileAnalysis(p.ai_profile_analysis || null);
  }

  function validateImageFile(file: File): boolean {
    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
      toast.error("Please upload a JPG, PNG or WEBP image");
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Photo must be under 10MB");
      return false;
    }
    return true;
  }

  function applyHighConfidenceSuggestions(analysis: AIProfileAnalysis) {
    const applied: string[] = [];

    if (!faceShape && analysis.face_shape.value && analysis.face_shape.confidence === "high") {
      setFaceShape(analysis.face_shape.value);
      applied.push("face shape");
    }
    if (!bodyType && analysis.body_type.value && analysis.body_type.confidence === "high") {
      setBodyType(analysis.body_type.value);
      applied.push("body type");
    }
    if (!complexion && analysis.complexion.value && analysis.complexion.confidence === "high") {
      setComplexion(analysis.complexion.value);
      applied.push("complexion");
    }
    if (!hairTexture && analysis.hair_texture.value && analysis.hair_texture.confidence === "high") {
      setHairTexture(analysis.hair_texture.value);
      applied.push("hair texture");
    }
    if (!hairLength && analysis.hair_length.value && analysis.hair_length.confidence === "high") {
      setHairLength(analysis.hair_length.value);
      applied.push("hair length");
    }

    if (applied.length) {
      toast.success(`Applied high-confidence suggestions for ${applied.join(", ")}`);
    }
  }

  function applyAnalysisValue(field: "body_type" | "complexion" | "face_shape" | "hair_texture" | "hair_length", value?: string | null) {
    if (!value) return;
    if (field === "body_type") setBodyType(value);
    if (field === "complexion") setComplexion(value);
    if (field === "face_shape") setFaceShape(value);
    if (field === "hair_texture") setHairTexture(value);
    if (field === "hair_length") setHairLength(value);
  }

  // Load profile
  useEffect(() => {
    const hu = (localStorage.getItem("luxelook_height_unit") || "cm") as "cm" | "in";
    const wu = (localStorage.getItem("luxelook_weight_unit") || "kg") as "kg" | "lbs";
    setHeightUnit(hu);
    setWeightUnit(wu);
    getProfile()
      .then(p => {
        syncProfileState(p);
        if (p.height_cm) setHeightVal(
          hu === "in" ? (p.height_cm / 2.54).toFixed(1) : String(p.height_cm)
        );
        if (p.weight_kg) setWeightVal(
          wu === "lbs" ? (p.weight_kg * 2.20462).toFixed(1) : String(p.weight_kg)
        );
      })
      .catch(() => toast.error("Failed to load profile"))
      .finally(() => setLoading(false));
  }, []);

  function handleHeightUnitToggle(unit: string) {
    const u = unit as "cm" | "in";
    localStorage.setItem("luxelook_height_unit", u);
    if (heightVal) {
      const v = parseFloat(heightVal);
      setHeightVal(u === "in" ? (v / 2.54).toFixed(1) : (v * 2.54).toFixed(0));
    }
    setHeightUnit(u);
  }

  function handleWeightUnitToggle(unit: string) {
    const u = unit as "kg" | "lbs";
    localStorage.setItem("luxelook_weight_unit", u);
    if (weightVal) {
      const v = parseFloat(weightVal);
      setWeightVal(u === "lbs" ? (v * 2.20462).toFixed(1) : (v / 2.20462).toFixed(1));
    }
    setWeightUnit(u);
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!validateImageFile(file)) return;

    setCropFile(file);
    if (profilePhotoInputRef.current) profilePhotoInputRef.current.value = "";
  }

  async function uploadAIPhotoBlob(blob: Blob, filename: string) {
    setAiPhotoUploading(true);
    const previewUrl = URL.createObjectURL(blob);
    setAiPhotoPreview(previewUrl);

    try {
      const data = await uploadAIProfilePhoto(blob, filename);
      setAiPhotoPreview(data.ai_profile_photo_url);
      URL.revokeObjectURL(previewUrl);
      setProfileAnalysis(data.ai_profile_analysis);
      setProfile(prev => prev ? {
        ...prev,
        ai_profile_photo_url: data.ai_profile_photo_url,
        ai_profile_analysis: data.ai_profile_analysis,
        ai_profile_analyzed_at: data.ai_profile_analyzed_at,
      } : prev);
      applyHighConfidenceSuggestions(data.ai_profile_analysis);
      toast.success("AI profiling photo analyzed!");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not analyze AI profiling photo — please try again");
      setAiPhotoPreview(profile?.ai_profile_photo_url || null);
      URL.revokeObjectURL(previewUrl);
    } finally {
      setAiPhotoUploading(false);
    }
  }

  async function handleAIPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!validateImageFile(file)) return;
    if (aiPhotoInputRef.current) aiPhotoInputRef.current.value = "";
    await uploadAIPhotoBlob(file, file.name || "ai-profile.jpg");
  }

  async function handleUseProfilePhotoForAnalysis() {
    if (!photoPreview) {
      toast.error("Upload a profile photo first");
      return;
    }

    setAiPhotoUploading(true);
    try {
      const response = await fetch(photoPreview);
      if (!response.ok) throw new Error("Could not load the profile photo");
      const blob = await response.blob();
      await uploadAIPhotoBlob(blob, "profile-photo-analysis.jpg");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not reuse the profile photo");
    } finally {
      if (aiPhotoInputRef.current) aiPhotoInputRef.current.value = "";
    }
  }

  async function handleSave() {
    // Validate height range
    if (heightVal) {
      const hCm = heightUnit === "in" ? parseFloat(heightVal) * 2.54 : parseFloat(heightVal);
      if (hCm < 50 || hCm > 250) {
        toast.error("Height looks out of range — please check your entry");
        return;
      }
    }
    // Validate weight range
    if (weightVal) {
      const wKg = weightUnit === "lbs" ? parseFloat(weightVal) / 2.20462 : parseFloat(weightVal);
      if (wKg < 20 || wKg > 300) {
        toast.error("Weight looks out of range — please check your entry");
        return;
      }
    }

    setSaving(true);
    try {
      const heightCm = heightVal
        ? heightUnit === "in" ? parseFloat(heightVal) * 2.54 : parseFloat(heightVal)
        : undefined;
      const weightKg = weightVal
        ? weightUnit === "lbs" ? parseFloat(weightVal) / 2.20462 : parseFloat(weightVal)
        : undefined;

      const updated = await updateProfile({
        body_type:  bodyType   || undefined,
        age_range:  ageRange   || undefined,
        height_cm: heightCm,
        weight_kg: weightKg,
        complexion: complexion || undefined,
        face_shape: faceShape  || undefined,
        hairstyle: [hairTexture, hairLength].filter(Boolean).join(", ") || undefined,
      });
      syncProfileState(updated);
      toast.success("Profile saved!");
    } catch {
      toast.error("Could not save profile — please try again");
    } finally {
      setSaving(false);
    }
  }

  async function handleCropComplete(blob: Blob) {
    setCropFile(null);
    setPhotoUploading(true);

    // Show preview immediately from blob
    const previewUrl = URL.createObjectURL(blob);
    setPhotoPreview(previewUrl);

    try {
      const data = await uploadProfilePhoto(blob, "profile.jpg");
      setPhotoPreview(data.photo_url);
      setProfile(prev => prev ? { ...prev, photo_url: data.photo_url } : prev);
      URL.revokeObjectURL(previewUrl);
      toast.success("Photo uploaded!");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not upload photo — please try again");
      setPhotoPreview(profile?.photo_url || null);
      URL.revokeObjectURL(previewUrl);
    } finally {
      setPhotoUploading(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <Navbar />
        <div style={{ textAlign: "center", padding: "120px 24px" }}>
          <div style={{
            width: "40px", height: "40px", margin: "0 auto",
            border: "3px solid var(--border)", borderTop: "3px solid var(--gold)",
            borderRadius: "50%", animation: "spin 0.8s linear infinite",
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </>
    );
  }

  return (
    <>
      <Head><title>My Profile — LuxeLook AI</title></Head>
      <Navbar />
      <main className="page-main" style={{ maxWidth: "680px", margin: "0 auto", padding: "48px 24px" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <User size={22} color="var(--gold)" />
          <h1 className="type-page-title" style={{ fontSize: "34px", color: "var(--charcoal)" }}>My Profile</h1>
        </div>
        <p className="type-body" style={{ color: "var(--muted)", fontSize: "15px", marginBottom: "40px" }}>
          {profile?.email}
        </p>

        {/* ── Profile photo ── */}
        <section className="profile-photo-section" style={{ marginBottom: "40px", display: "flex", alignItems: "flex-start", gap: "24px" }}>
          <div style={{ position: "relative", flexShrink: 0 }}>
            <div style={{
              width: "96px", height: "96px", borderRadius: "50%",
              background: "var(--surface)", border: "2px solid var(--border)",
              overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {photoPreview
                ? <Image src={photoPreview} alt="Profile" fill unoptimized={shouldBypassImageOptimization(photoPreview)} sizes="96px" style={{ objectFit: "cover" }} />
                : <User size={40} color="var(--border)" />
              }
              {photoUploading && (
                <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)",
                  display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%" }}>
                  <div style={{ width: "20px", height: "20px", border: "2px solid white",
                    borderTop: "2px solid transparent", borderRadius: "50%",
                    animation: "spin 0.8s linear infinite" }} />
                </div>
              )}
            </div>
            <button
              onClick={() => profilePhotoInputRef.current?.click()}
              disabled={photoUploading}
              title="Upload photo"
              style={{
                position: "absolute", bottom: 0, right: 0,
                width: "28px", height: "28px", borderRadius: "50%",
                background: "var(--gold)", border: "2px solid var(--surface)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: photoUploading ? "not-allowed" : "pointer",
              }}>
              <Camera size={13} color="white" />
            </button>
            <input ref={profilePhotoInputRef} type="file" accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }} onChange={handlePhotoChange} />
          </div>

          <div style={{ flex: 1 }}>
            <p className="type-body" style={{ fontSize: "14px", color: "var(--ink)", fontWeight: 500, marginBottom: "4px" }}>
              Profile photo
            </p>
            <p className="type-helper" style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6, marginBottom: "8px" }}>
              This is your visible avatar. We crop it to a square and use it for your profile display only.
            </p>
            <p className="type-micro" style={{ fontSize: "11px", color: "var(--muted)" }}>
              JPG, PNG or WEBP · Max 10MB
            </p>
          </div>
        </section>

        {/* ── AI profiling photo ── */}
        <section style={{
          marginBottom: "40px",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          background: "var(--surface)",
          overflow: "hidden",
        }}>
          <button
            onClick={() => setShowAIProfiling(prev => !prev)}
            style={{
              width: "100%",
              padding: "16px 18px",
              background: "transparent",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
            }}
          >
            <div style={{ textAlign: "left" }}>
              <p className="type-body" style={{ fontSize: "14px", color: "var(--ink)", fontWeight: 600, margin: 0 }}>
                AI profiling photo
              </p>
              <p className="type-helper" style={{ fontSize: "12px", color: "var(--muted)", margin: "4px 0 0" }}>
                {aiPhotoPreview
                  ? "Separate analysis image for face, body, complexion, and hair suggestions"
                  : "Add a dedicated analysis photo without changing your visible avatar"}
              </p>
            </div>
            {showAIProfiling
              ? <ChevronUp size={16} color="var(--muted)" />
              : <ChevronDown size={16} color="var(--muted)" />}
          </button>

          {showAIProfiling && (
            <div style={{ padding: "0 18px 18px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "24px", flexWrap: "wrap" }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <div style={{
                    width: "104px", minHeight: "132px", borderRadius: "18px",
                    background: "var(--surface)", border: "2px solid var(--border)",
                  overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {aiPhotoPreview
                      ? <Image src={aiPhotoPreview} alt="AI profiling" fill unoptimized={shouldBypassImageOptimization(aiPhotoPreview)} sizes="104px" style={{ objectFit: "cover" }} />
                      : <User size={40} color="var(--border)" />
                    }
                    {aiPhotoUploading && (
                      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)",
                        display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "18px" }}>
                        <div style={{ width: "20px", height: "20px", border: "2px solid white",
                          borderTop: "2px solid transparent", borderRadius: "50%",
                          animation: "spin 0.8s linear infinite" }} />
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => aiPhotoInputRef.current?.click()}
                    disabled={aiPhotoUploading}
                    title="Upload AI profiling photo"
                    style={{
                      position: "absolute", bottom: 0, right: 0,
                      width: "28px", height: "28px", borderRadius: "50%",
                      background: "var(--gold)", border: "2px solid var(--surface)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: aiPhotoUploading ? "not-allowed" : "pointer",
                    }}>
                    <Camera size={13} color="white" />
                  </button>
                  <input ref={aiPhotoInputRef} type="file" accept="image/jpeg,image/png,image/webp"
                    style={{ display: "none" }} onChange={handleAIPhotoChange} />
                </div>

                <div style={{ flex: 1, minWidth: "280px" }}>
                  <p className="type-helper" style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6, marginBottom: "8px" }}>
                    Upload a clear front-facing photo for AI analysis. We use this separately from your avatar
                    to suggest face shape, body type, complexion, and hair traits.
                  </p>
                  <p className="type-helper" style={{ fontSize: "12px", color: "var(--muted)", margin: "0 0 10px" }}>
                    The AI photo and analysis are saved immediately. Your chosen profile fields update only when you click Save Profile.
                  </p>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "8px" }}>
                    <button
                      onClick={() => aiPhotoInputRef.current?.click()}
                      disabled={aiPhotoUploading}
                      style={{
                        padding: "8px 14px",
                        borderRadius: "999px",
                        border: "1px solid var(--gold)",
                        background: "var(--gold)",
                        color: "#0A0908",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: aiPhotoUploading ? "not-allowed" : "pointer",
                      }}
                    >
                      {aiPhotoPreview ? "Replace AI photo" : "Upload AI photo"}
                    </button>
                    <button
                      onClick={handleUseProfilePhotoForAnalysis}
                      disabled={aiPhotoUploading || !photoPreview}
                      style={{
                        padding: "8px 14px",
                        borderRadius: "999px",
                        border: "1px solid var(--border)",
                        background: "var(--surface)",
                        color: photoPreview ? "var(--charcoal)" : "var(--muted)",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: aiPhotoUploading || !photoPreview ? "not-allowed" : "pointer",
                      }}
                    >
                      Use profile photo
                    </button>
                  </div>
                  <p className="type-micro" style={{ fontSize: "11px", color: "var(--muted)", margin: 0 }}>
                    JPG, PNG or WEBP · Max 10MB
                  </p>

                  {profileAnalysis && (
                    <div style={{ marginTop: "14px", display: "grid", gap: "10px" }}>
                      <TraitCard
                        label="Face shape"
                        trait={profileAnalysis.face_shape}
                        currentValue={faceShape}
                        onApply={() => applyAnalysisValue("face_shape", profileAnalysis.face_shape.value)}
                      />
                      <TraitCard
                        label="Body type"
                        trait={profileAnalysis.body_type}
                        currentValue={bodyType}
                        onApply={() => applyAnalysisValue("body_type", profileAnalysis.body_type.value)}
                      />
                      <TraitCard
                        label="Complexion"
                        trait={profileAnalysis.complexion}
                        currentValue={complexion}
                        onApply={() => applyAnalysisValue("complexion", profileAnalysis.complexion.value)}
                      />
                      <TraitCard
                        label="Hair texture"
                        trait={profileAnalysis.hair_texture}
                        currentValue={hairTexture}
                        onApply={() => applyAnalysisValue("hair_texture", profileAnalysis.hair_texture.value)}
                      />
                      <TraitCard
                        label="Hair length"
                        trait={profileAnalysis.hair_length}
                        currentValue={hairLength}
                        onApply={() => applyAnalysisValue("hair_length", profileAnalysis.hair_length.value)}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── Basic info ── */}
        <section style={{ marginBottom: "40px" }}>
          <p className="type-kicker" style={{ ...labelStyle, fontSize: "13px", marginBottom: "20px" }}>Basic info</p>

          {/* Age range */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Age range</label>
              {AGE_RANGES.map(opt => (
                <button key={opt} onClick={() => setAgeRange(prev => prev === opt ? "" : opt)}
                  style={{
                    padding: "7px 16px", fontSize: "13px", borderRadius: "20px", cursor: "pointer",
                    border: `1px solid ${ageRange === opt ? "var(--charcoal)" : "var(--border)"}`,
                    background: ageRange === opt ? "var(--gold)" : "var(--surface)",
                    color: ageRange === opt ? "#0A0908" : "var(--muted)",
                    fontWeight: ageRange === opt ? 600 : 400,
                    transition: "all 0.15s",
                  }} className="type-chip">
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Body type */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap", marginBottom: "6px" }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Body type</label>
              <div style={{ width: "220px", maxWidth: "100%", marginRight: "auto" }}>
                <SelectField value={bodyType} onChange={setBodyType} options={BODY_TYPES} />
              </div>
              <CalcLinkButton label="Calculate mine" open={showBodyCalc} onClick={() => setShowBodyCalc(p => !p)} />
            </div>

            {showBodyCalc && (
              <InlinePanel>
                <p className="type-helper" style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "14px" }}>
                  Enter your measurements in {heightUnit === "in" ? "inches" : "cm"} at the fullest point
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                  {([
                    ["Bust",  bust,  setBust],
                    ["Waist", waist, setWaist],
                    ["Hips",  hip,   setHip],
                  ] as [string, string, (v: string) => void][]).map(([lbl, val, setter]) => (
                    <div key={lbl}>
                      <label style={labelStyle}>{lbl}</label>
                      <input type="number" min="0" value={val}
                        onChange={e => setter(e.target.value)}
                        placeholder="0" className="input"
                        style={{ padding: "8px 10px", fontSize: "14px", width: "100%" }} />
                    </div>
                  ))}
                </div>

                {bust && waist && hip && !bodyResult && (
                  <div style={{ marginTop: "10px", padding: "10px 12px", background: "rgba(212,169,106,0.12)",
                    borderRadius: "6px", border: "1px solid rgba(212,169,106,0.35)", display: "flex", gap: "8px", alignItems: "center" }}>
                    <AlertCircle size={14} color="var(--gold)" />
                    <p style={{ fontSize: "12px", color: "var(--gold)", margin: 0 }}>
                      Measurements look out of range — check you&apos;re using {heightUnit === "in" ? "inches" : "cm"} consistently
                    </p>
                  </div>
                )}

                {bodyResult && (
                  <ResultRow
                    label={bodyResult.result}
                    sublabel={BODY_TYPE_GUIDE[bodyResult.result]?.desc}
                    note={bodyResult.note}
                    onUse={() => { setBodyType(bodyResult.result); setShowBodyCalc(false); }}
                    onUseAlt={bodyResult.runner ? () => { setBodyType(bodyResult.runner!); setShowBodyCalc(false); } : undefined}
                    altLabel={bodyResult.runner}
                  />
                )}
              </InlinePanel>
            )}

            <GuideCard title="Body type guide"
              rows={Object.entries(BODY_TYPE_GUIDE).map(([k, v]) => ({
                label: k, desc: v.desc, extra: v.hint,
              }))} />
          </div>

          {/* Height + Weight */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Height</label>
                <UnitToggle value={heightUnit} options={["cm", "in"]} onChange={handleHeightUnitToggle} />
              </div>
              <input type="number" min="0" value={heightVal}
                onChange={e => setHeightVal(e.target.value)}
                placeholder={heightUnit === "cm" ? "e.g. 165" : "e.g. 65"}
                className="input" style={{ padding: "10px 12px", fontSize: "14px", width: "100%" }} />
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Weight</label>
                <UnitToggle value={weightUnit} options={["kg", "lbs"]} onChange={handleWeightUnitToggle} />
              </div>
              <input type="number" min="0" value={weightVal}
                onChange={e => setWeightVal(e.target.value)}
                placeholder={weightUnit === "kg" ? "e.g. 60" : "e.g. 132"}
                className="input" style={{ padding: "10px 12px", fontSize: "14px", width: "100%" }} />
            </div>
          </div>
        </section>

        {/* ── Personalised styling ── */}
        <section style={{ marginBottom: "40px" }}>
          <p className="type-kicker" style={{ ...labelStyle, fontSize: "13px", marginBottom: "20px" }}>Personalised styling</p>

          {/* Complexion */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap", marginBottom: "6px" }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Complexion</label>
              <div style={{ width: "220px", maxWidth: "100%", marginRight: "auto" }}>
                <SelectField value={complexion} onChange={setComplexion} options={COMPLEXIONS} />
              </div>
              <CalcLinkButton label="Help me identify" open={showComplexCalc} onClick={() => setShowComplexCalc(p => !p)} />
            </div>

            {showComplexCalc && (
              <InlinePanel>
                <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "16px" }}>
                  Answer 3 questions about your skin
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div>
                    <label style={labelStyle}>Look at the veins on your inner wrist — what colour are they?</label>
                    <ChipGroup
                      value={vein}
                      onChange={setVein}
                      options={[["blue-purple", "Blue / Purple"], ["green", "Green"], ["blue-green", "Mix of both"]]}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>How does your skin typically react to sun exposure?</label>
                    <ChipGroup
                      value={sun}
                      onChange={setSun}
                      options={[["burns", "Burns easily"], ["tans", "Tans gradually"], ["rarely", "Rarely burns or tans"]]}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Which best describes your overall skin depth?</label>
                    <ChipGroup
                      value={depth}
                      onChange={setDepth}
                      options={[["light", "Light"], ["medium", "Medium"], ["deep", "Deep"]]}
                    />
                  </div>
                </div>

                {(vein || sun || depth) && !(vein && sun && depth) && (
                  <p style={{ fontSize: "12px", color: "var(--muted)", marginTop: "12px" }}>
                    Answer all 3 questions to see your result
                  </p>
                )}

                {complexResult && (
                  <ResultRow
                    label={complexResult.display}
                    sublabel={COMPLEXION_GUIDE[complexResult.result]?.desc}
                    note={complexResult.runner
                      ? `Could lean either way — both ${complexResult.result} and ${complexResult.runner} are likely`
                      : undefined}
                    onUse={() => { setComplexion(complexResult.result); setShowComplexCalc(false); }}
                    onUseAlt={complexResult.runner
                      ? () => { setComplexion(complexResult.runner!); setShowComplexCalc(false); }
                      : undefined}
                    altLabel={complexResult.runner}
                  />
                )}
              </InlinePanel>
            )}

            <GuideCard title="Complexion guide"
              rows={Object.entries(COMPLEXION_GUIDE).map(([k, v]) => ({
                label: k, desc: v.desc, extra: `${v.undertone} undertone`,
              }))} />
          </div>

          {/* Face shape */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Face shape</label>
              <div style={{ width: "220px", maxWidth: "100%" }}>
                <SelectField value={faceShape} onChange={setFaceShape} options={FACE_SHAPES} />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "8px", flexWrap: "wrap" }}>
              <p className="type-helper" style={{ fontSize: "12px", color: "var(--muted)", margin: 0 }}>
                {profileAnalysis?.face_shape.value ? "AI suggested a result above — or" : "Use the AI profiling photo above, or"}
              </p>
              <button onClick={() => setShowFaceTool(p => !p)}
                style={{ fontSize: "12px", fontWeight: 600, color: "var(--gold)",
                  background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                {showFaceTool ? "close tool" : "mark it yourself"}
              </button>
            </div>
            {showFaceTool && (
              <div style={{ marginTop: "16px", padding: "20px", background: "var(--surface)",
                borderRadius: "10px", border: "1px solid var(--border)" }}>
                <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "16px" }}>
                  Place 8 points on your photo matching the numbered reference diagram.
                  Drag any placed point to reposition it.
                </p>
                <FaceShapeTool
                  key={aiPhotoPreview || photoPreview || "no-photo"}
                  photoUrl={aiPhotoPreview || photoPreview}
                  onResult={(shape) => {
                    setFaceShape(shape);
                    setShowFaceTool(false);
                    toast.success(`Face shape set to ${shape}`);
                  }}
                />
              </div>
            )}
            <GuideCard title="Face shape guide"
              rows={Object.entries(FACE_SHAPE_GUIDE).map(([k, v]) => ({
                label: k, desc: v.desc, extra: v.styles,
              }))} />
          </div>

          {/* Hairstyle */}
          <div>
            <label style={labelStyle}>Hairstyle</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

              <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
                <p className="type-helper" style={{ fontSize: "12px", color: "var(--muted)", margin: 0, minWidth: "56px" }}>Texture</p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {HAIR_TEXTURE.map(opt => (
                    <button key={opt} onClick={() => setHairTexture(prev => prev === opt ? "" : opt)}
                      style={{
                        padding: "7px 16px", fontSize: "13px", borderRadius: "20px", cursor: "pointer",
                        border: `1px solid ${hairTexture === opt ? "var(--charcoal)" : "var(--border)"}`,
                        background: hairTexture === opt ? "var(--gold)" : "var(--surface)",
                        color: hairTexture === opt ? "#0A0908" : "var(--muted)",
                        textTransform: "capitalize", transition: "all 0.15s",
                      }} className="type-chip">
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
                <p className="type-helper" style={{ fontSize: "12px", color: "var(--muted)", margin: 0, minWidth: "56px" }}>Length</p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {HAIR_LENGTH.map(opt => (
                    <button key={opt} onClick={() => setHairLength(prev => prev === opt ? "" : opt)}
                      style={{
                        padding: "7px 16px", fontSize: "13px", borderRadius: "20px", cursor: "pointer",
                        border: `1px solid ${hairLength === opt ? "var(--charcoal)" : "var(--border)"}`,
                        background: hairLength === opt ? "var(--gold)" : "var(--surface)",
                        color: hairLength === opt ? "#0A0908" : "var(--muted)",
                        textTransform: "capitalize", transition: "all 0.15s",
                      }} className="type-chip">
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Save ── */}
        <button className="btn-primary" onClick={handleSave} disabled={saving}
          style={{ width: "100%" }}>
          {saving ? "Saving…" : "Save Profile"}
        </button>

      </main>
      {/* Photo crop modal */}
      {cropFile && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "24px",
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setCropFile(null); }}
        >
          <div style={{
            background: "var(--surface)",
            borderRadius: "16px", padding: "24px",
            width: "100%", maxWidth: "400px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <PhotoCropper
              file={cropFile}
              onCrop={handleCropComplete}
              onCancel={() => setCropFile(null)}
            />
          </div>
        </div>
      )}
    </>
  );
}
