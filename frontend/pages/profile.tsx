/**
 * pages/profile.tsx — User profile page
 * - Body type: inline calculator with scored matching, top-2 on borderline
 * - Complexion: inline 3-question guide, slash notation on ambiguous result
 * - Face shape: auto-detected from profile photo via OpenAI Vision; guide chart shown
 * - Height: cm / in toggle, stores cm
 * - Weight: kg / lbs toggle, stores kg
 * - Photo: uploads to profile-photos bucket, triggers face shape detection
 */

import { useEffect, useRef, useState } from "react";
import Head from "next/head";
import Navbar from "@/components/layout/Navbar";
import { FaceShapeTool } from "@/components/FaceShapeTool";
import { PhotoCropper } from "@/components/PhotoCropper";
import { getProfile, updateProfile, UserProfile } from "@/services/api";
import { User, ChevronDown, ChevronUp, Camera, AlertCircle, CheckCircle } from "lucide-react";
import toast from "react-hot-toast";

// ── Static data ───────────────────────────────────────────────────────────────

const BODY_TYPES  = ["hourglass", "pear", "apple", "rectangle", "inverted triangle"];
const COMPLEXIONS = ["fair", "light", "medium", "olive", "tan", "deep"];
const FACE_SHAPES = ["oval", "round", "square", "heart", "diamond", "oblong"];
const HAIR_TEXTURE = ["straight", "wavy", "curly", "coily"];
const HAIR_LENGTH  = ["short", "medium", "long"];

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
            color: value === opt ? "white" : "var(--muted)",
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
            background: value === val ? "var(--charcoal)" : "white",
            color: value === val ? "white" : "var(--ink)",
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
    <div style={{ marginTop: "10px", padding: "12px 14px", background: "white",
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

// ── Main component ────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const [profile,        setProfile]        = useState<UserProfile | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [saving,         setSaving]         = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [photoPreview,   setPhotoPreview]   = useState<string | null>(null);
  const [faceDetected,   setFaceDetected]   = useState<{ shape: string; confidence: string; reason: string } | null>(null);
  const [showFaceTool, setShowFaceTool] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Core form state
  const [bodyType,    setBodyType]    = useState("");
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

  // Load profile
  useEffect(() => {
    const hu = (localStorage.getItem("luxelook_height_unit") || "cm") as "cm" | "in";
    const wu = (localStorage.getItem("luxelook_weight_unit") || "kg") as "kg" | "lbs";
    setHeightUnit(hu);
    setWeightUnit(wu);
    getProfile()
      .then(p => {
        setProfile(p);
        setBodyType(p.body_type   || "");
        setComplexion(p.complexion || "");
        setFaceShape(p.face_shape  || "");
        // stored as "texture, length" — split back into two fields
        const parts = (p.hairstyle || "").split(",").map(s => s.trim());
        setHairTexture(parts.find(p => HAIR_TEXTURE.includes(p)) || "");
        setHairLength(parts.find(p => HAIR_LENGTH.includes(p))  || "");
        setPhotoPreview(p.photo_url || null);
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

    // Validate type
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file (JPG, PNG, WEBP)");
      return;
    }
    // Validate size — max 10MB
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Photo must be under 10MB");
      return;
    }

    // Show cropper instead of uploading directly
    setCropFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = ev => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    setPhotoUploading(true);
    setFaceDetected(null);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/profile/photo`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem("luxelook_token")}` },
          body: formData,
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || "Upload failed");
      }

      const data = await res.json();
      toast.success("Photo uploaded!");

      if (data.face_shape && data.face_confidence !== "low") {
        setFaceDetected({
          shape:      data.face_shape,
          confidence: data.face_confidence,
          reason:     data.face_reason || "",
        });
        // Auto-fill only on high confidence
        if (data.face_confidence === "high") {
          setFaceShape(data.face_shape);
          toast.success(`Face shape detected: ${data.face_shape}`, { duration: 4000 });
        }
      } else if (data.face_shape === null) {
        toast("No face detected in photo — face shape not updated", { icon: "ℹ️", duration: 4000 });
        setShowFaceTool(true);
      }
    } catch (err: any) {
      toast.error(err?.message || "Could not upload photo — please try again");
      // Revert preview on failure
      setPhotoPreview(profile?.photo_url || null);
    } finally {
      setPhotoUploading(false);
      // Reset file input so same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = "";
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
        height_cm: heightCm,
        weight_kg: weightKg,
        complexion: complexion || undefined,
        face_shape: faceShape  || undefined,
        hairstyle: [hairTexture, hairLength].filter(Boolean).join(", ") || undefined,
      });
      setProfile(updated);
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
    setFaceDetected(null);

    // Show preview immediately from blob
    const previewUrl = URL.createObjectURL(blob);
    setPhotoPreview(previewUrl);

    try {
      const formData = new FormData();
      formData.append("photo", blob, "profile.jpg");
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/profile/photo`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem("luxelook_token")}` },
          body: formData,
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || "Upload failed");
      }

      const data = await res.json();
      setPhotoPreview(data.photo_url);
      URL.revokeObjectURL(previewUrl);
      toast.success("Photo uploaded!");

      if (data.face_shape && data.face_confidence !== "low") {
        setFaceDetected({
          shape:      data.face_shape,
          confidence: data.face_confidence,
          reason:     data.face_reason || "",
        });
        if (data.face_confidence === "high") {
          setFaceShape(data.face_shape);
          toast.success(`Face shape detected: ${data.face_shape}`, { duration: 4000 });
        }
      } else if (data.face_shape === null) {
        toast("No face detected — mark your face shape manually", { icon: "ℹ️", duration: 4000 });
        setShowFaceTool(true);
      }
    } catch (err: any) {
      toast.error(err?.message || "Could not upload photo — please try again");
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
      <main style={{ maxWidth: "680px", margin: "0 auto", padding: "48px 24px" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <User size={22} color="var(--gold)" />
          <h1 style={{ fontSize: "34px", color: "var(--charcoal)" }}>My Profile</h1>
        </div>
        <p style={{ color: "var(--muted)", fontSize: "15px", marginBottom: "40px" }}>
          {profile?.email}
        </p>

        {/* ── Profile photo ── */}
        <section style={{ marginBottom: "40px", display: "flex", alignItems: "flex-start", gap: "24px" }}>
          <div style={{ position: "relative", flexShrink: 0 }}>
            <div style={{
              width: "96px", height: "96px", borderRadius: "50%",
              background: "var(--surface)", border: "2px solid var(--border)",
              overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {photoPreview
                ? <img src={photoPreview} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
              onClick={() => fileInputRef.current?.click()}
              disabled={photoUploading}
              title="Upload photo"
              style={{
                position: "absolute", bottom: 0, right: 0,
                width: "28px", height: "28px", borderRadius: "50%",
                background: "var(--charcoal)", border: "2px solid white",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: photoUploading ? "not-allowed" : "pointer",
              }}>
              <Camera size={13} color="white" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }} onChange={handlePhotoChange} />
          </div>

          <div style={{ flex: 1 }}>
            <p style={{ fontSize: "14px", color: "var(--ink)", fontWeight: 500, marginBottom: "4px" }}>
              Profile photo
            </p>
            <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6, marginBottom: "8px" }}>
              Upload a clear front-facing photo. We use it to detect your face shape automatically
              and will use it for outfit previews in a future update.
            </p>
            <p style={{ fontSize: "11px", color: "var(--muted)" }}>
              JPG, PNG or WEBP · Max 10MB
            </p>

            {/* Face detection result banner */}
            {faceDetected && (
              <div style={{
                marginTop: "10px", padding: "10px 14px", borderRadius: "8px",
                background: faceDetected.confidence === "high" ? "#F0FDF4" : "#FFFBEB",
                border: `1px solid ${faceDetected.confidence === "high" ? "#86EFAC" : "#FDE68A"}`,
                display: "flex", alignItems: "flex-start", gap: "8px",
              }}>
                {faceDetected.confidence === "high"
                  ? <CheckCircle size={15} color="#16A34A" style={{ flexShrink: 0, marginTop: "1px" }} />
                  : <AlertCircle size={15} color="#D97706" style={{ flexShrink: 0, marginTop: "1px" }} />
                }
                <div>
                  <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--charcoal)",
                    margin: 0, textTransform: "capitalize" }}>
                    {faceDetected.confidence === "high"
                      ? `Face shape detected: ${faceDetected.shape}`
                      : `Possible face shape: ${faceDetected.shape} (review recommended)`
                    }
                  </p>
                  {faceDetected.reason && (
                    <p style={{ fontSize: "12px", color: "var(--muted)", margin: "2px 0 0" }}>
                      {faceDetected.reason}
                    </p>
                  )}
                  {faceDetected.confidence === "medium" && (
                    <button onClick={() => { setFaceShape(faceDetected.shape); setFaceDetected(null); }}
                      style={{ marginTop: "6px", fontSize: "12px", fontWeight: 600, color: "var(--gold)",
                        background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                      Accept this result →
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Basic info ── */}
        <section style={{ marginBottom: "40px" }}>
          <p style={{ ...labelStyle, fontSize: "13px", marginBottom: "20px" }}>Basic info</p>

          {/* Body type */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Body type</label>
              <CalcLinkButton label="Calculate mine" open={showBodyCalc} onClick={() => setShowBodyCalc(p => !p)} />
            </div>
            <SelectField value={bodyType} onChange={setBodyType} options={BODY_TYPES} />

            {showBodyCalc && (
              <InlinePanel>
                <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "14px" }}>
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

                {/* Validation warning */}
                {bust && waist && hip && !bodyResult && (
                  <div style={{ marginTop: "10px", padding: "10px 12px", background: "#FEF3C7",
                    borderRadius: "6px", display: "flex", gap: "8px", alignItems: "center" }}>
                    <AlertCircle size={14} color="#D97706" />
                    <p style={{ fontSize: "12px", color: "#92400E", margin: 0 }}>
                      Measurements look out of range — check you're using {heightUnit === "in" ? "inches" : "cm"} consistently
                    </p>
                  </div>
                )}

                {/* Result */}
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
          <p style={{ ...labelStyle, fontSize: "13px", marginBottom: "20px" }}>Personalised styling</p>

          {/* Complexion */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Complexion</label>
              <CalcLinkButton label="Help me identify" open={showComplexCalc} onClick={() => setShowComplexCalc(p => !p)} />
            </div>
            <SelectField value={complexion} onChange={setComplexion} options={COMPLEXIONS} />

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

                {/* Incomplete state */}
                {(vein || sun || depth) && !(vein && sun && depth) && (
                  <p style={{ fontSize: "12px", color: "var(--muted)", marginTop: "12px" }}>
                    Answer all 3 questions to see your result
                  </p>
                )}

                {/* Result */}
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
            <label style={labelStyle}>Face shape</label>
            <SelectField value={faceShape} onChange={setFaceShape} options={FACE_SHAPES} />
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "8px" }}>
              <p style={{ fontSize: "12px", color: "var(--muted)", margin: 0 }}>
                {faceDetected ? "AI detected above — or" : "Upload a photo for auto-detection, or"}
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
                    key={photoPreview || "no-photo"}
                  photoUrl={photoPreview}
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

              <div>
                <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "8px" }}>Texture</p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {HAIR_TEXTURE.map(opt => (
                    <button key={opt} onClick={() => setHairTexture(prev => prev === opt ? "" : opt)}
                      style={{
                        padding: "7px 16px", fontSize: "13px", borderRadius: "20px", cursor: "pointer",
                        border: `1px solid ${hairTexture === opt ? "var(--charcoal)" : "var(--border)"}`,
                        background: hairTexture === opt ? "var(--charcoal)" : "white",
                        color: hairTexture === opt ? "white" : "var(--ink)",
                        textTransform: "capitalize", transition: "all 0.15s",
                      }}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "8px" }}>Length</p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {HAIR_LENGTH.map(opt => (
                    <button key={opt} onClick={() => setHairLength(prev => prev === opt ? "" : opt)}
                      style={{
                        padding: "7px 16px", fontSize: "13px", borderRadius: "20px", cursor: "pointer",
                        border: `1px solid ${hairLength === opt ? "var(--charcoal)" : "var(--border)"}`,
                        background: hairLength === opt ? "var(--charcoal)" : "white",
                        color: hairLength === opt ? "white" : "var(--ink)",
                        textTransform: "capitalize", transition: "all 0.15s",
                      }}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              {(hairTexture || hairLength) && (
                <p style={{ fontSize: "12px", color: "var(--muted)" }}>
                  {[hairTexture, hairLength].filter(Boolean).join(", ")}
                </p>
              )}
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
            background: "#FFFFFF",
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
