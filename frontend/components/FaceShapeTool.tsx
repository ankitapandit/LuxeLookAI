/**
 * components/FaceShapeTool.tsx
 * Canvas-based face landmark tool.
 * User places 8 numbered points on their uploaded photo.
 * Shape is calculated from point geometry (no measurements needed).
 * Side-by-side layout: user photo (left) + labeled reference diagram (right).
 */

import { useEffect, useRef, useState } from "react";

// ── Point definitions ─────────────────────────────────────────────────────────

const POINTS = [
  { id: 1, label: "Top of forehead",    color: "#6B5CE7", hint: "The highest point of your forehead hairline" },
  { id: 2, label: "Left temple",        color: "#0F9B8E", hint: "Where your forehead meets your left side" },
  { id: 3, label: "Right temple",       color: "#0F9B8E", hint: "Where your forehead meets your right side" },
  { id: 4, label: "Left cheek edge",    color: "#E24B4A", hint: "Widest point of your left cheek / near ear" },
  { id: 5, label: "Right cheek edge",   color: "#E24B4A", hint: "Widest point of your right cheek / near ear" },
  { id: 6, label: "Left jaw corner",    color: "#D97706", hint: "Where your jaw angles down on the left" },
  { id: 7, label: "Right jaw corner",   color: "#D97706", hint: "Where your jaw angles down on the right" },
  { id: 8, label: "Chin",              color: "#6B7280", hint: "The lowest point of your chin" },
];

interface Point { id: number; x: number; y: number }

// ── Geometry ──────────────────────────────────────────────────────────────────

function dist(a: Point, b: Point) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function calcFaceShape(pts: Point[]): { shape: string; desc: string } | null {
  const byId = Object.fromEntries(pts.map(p => [p.id, p]));
  if (Object.keys(byId).length < 8) return null;

  const forehead   = dist(byId[2], byId[3]);
  const cheekbone  = dist(byId[4], byId[5]);
  const jaw        = dist(byId[6], byId[7]);
  const faceLength = dist(byId[1], byId[8]);

  if (!cheekbone) return null;

  const foreheadR = forehead  / cheekbone;
  const jawR      = jaw       / cheekbone;
  const lengthR   = faceLength / cheekbone;

  let shape: string;
  if      (lengthR > 1.4 && Math.abs(foreheadR - jawR) < 0.15)     shape = "oblong";
  else if (foreheadR < 0.72 && jawR < 0.75)                         shape = "diamond";
  else if (jawR < 0.72 && foreheadR > 0.85)                         shape = "heart";
  else if (Math.abs(foreheadR - jawR) < 0.12 && lengthR < 1.05)     shape = "round";
  else if (Math.abs(foreheadR - jawR) < 0.12 && foreheadR > 0.80)   shape = "square";
  else                                                                shape = "oval";

  const DESCS: Record<string, string> = {
    oval:    "Balanced proportions, slightly wider at cheekbones",
    round:   "Similar width and length, full cheeks, rounded jaw",
    square:  "Strong jaw, forehead and jaw similar width",
    heart:   "Wider forehead tapering to a narrow pointed chin",
    diamond: "Narrow forehead and jaw, wide cheekbones",
    oblong:  "Longer than wide, forehead and jaw similar width",
  };

  return { shape, desc: DESCS[shape] || "" };
}

// ── Reference diagram ─────────────────────────────────────────────────────────

function ReferenceDiagram() {
  // Fixed positions for the 8 reference points on a 160x200 face outline
  const refPoints: Record<number, [number, number]> = {
    1: [90,  26],  // top forehead
    2: [38,  62],  // left temple
    3: [142, 62],  // right temple
    4: [26,  105], // left cheek
    5: [155, 105], // right cheek
    6: [35,  155], // left jaw corner
    7: [145, 155], // right jaw corner
    8: [90,  199], // chin
  };

  return (
    <div style={{ flexShrink: 0, width: "180px" }}>
      <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)",
        textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "8px" }}>
        Reference
      </p>
      <svg viewBox="0 0 180 220" width="180" height="220">
        {/* Face outline */}
        <ellipse cx="90" cy="112" rx="65" ry="88"
          fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" />
        {/* Eyes */}
        <ellipse cx="68"  cy="90" rx="14" ry="8" fill="none" stroke="#D1D5DB" strokeWidth="1" />
        <ellipse cx="112" cy="90" rx="14" ry="8" fill="none" stroke="#D1D5DB" strokeWidth="1" />
        {/* Nose hint */}
        <path d="M90 100 Q84 120 90 128 Q96 120 90 100"
          fill="none" stroke="#D1D5DB" strokeWidth="1" />
        {/* Mouth hint */}
        <path d="M76 148 Q90 158 104 148"
          fill="none" stroke="#D1D5DB" strokeWidth="1" />
        {/* Points */}
        {POINTS.map(pt => {
          const [cx, cy] = refPoints[pt.id];
          return (
            <g key={pt.id}>
              <circle cx={cx} cy={cy} r="9" fill={pt.color} opacity="0.15" />
              <circle cx={cx} cy={cy} r="5" fill={pt.color} />
              <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
                style={{ fontSize: "8px", fill: "white", fontWeight: 700 }}>
                {pt.id}
              </text>
            </g>
          );
        })}
      </svg>
      {/* Legend */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "8px" }}>
        {POINTS.map(pt => (
          <div key={pt.id} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: "14px", height: "14px", borderRadius: "50%",
              background: pt.color, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "7px", color: "white", fontWeight: 700 }}>{pt.id}</span>
            </div>
            <span style={{ fontSize: "11px", color: "var(--muted)" }}>{pt.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface FaceShapeToolProps {
  photoUrl: string | null;
  onResult: (shape: string) => void;
}

export function FaceShapeTool({ photoUrl, onResult }: FaceShapeToolProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const imgRef     = useRef<HTMLImageElement | null>(null);
  const [points,   setPoints]   = useState<Point[]>([]);
  const [result,   setResult]   = useState<{ shape: string; desc: string } | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 260, h: 320 });
  const [dragging, setDragging] = useState<number | null>(null);

  const nextId = points.length < 8 ? points.length + 1 : null;
  const currentStep = nextId ? POINTS[nextId - 1] : null;

  // Load image onto canvas
  useEffect(() => {
  if (!photoUrl) return;

    // Fetch as blob to avoid canvas CORS taint
    fetch(photoUrl, { mode: "cors" })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        if (!blob || blob.size === 0) throw new Error("Empty blob");
        const localUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          imgRef.current = img;
          const scale = 260 / img.naturalWidth;
          const h = Math.min(img.naturalHeight * scale, 360);
          setCanvasSize({ w: 260, h });
          setImgReady(true);
          URL.revokeObjectURL(localUrl);
        };
        img.onerror = () => {
          setImgReady(false);
        };
        img.src = localUrl;
      })
      .catch(() => {
        setImgReady(false);
      });
  }, [photoUrl]);

  // Redraw canvas when points change
  useEffect(() => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !imgReady) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw photo
    if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Draw guide lines between symmetric pairs when both placed
    const pairs: [number, number][] = [[2,3],[4,5],[6,7]];
    pairs.forEach(([a, b]) => {
      const pa = points.find(p => p.id === a);
      const pb = points.find(p => p.id === b);
      if (pa && pb) {
        ctx.beginPath();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = POINTS[a - 1].color + "80";
        ctx.lineWidth = 1;
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
    // Face length line
    const p1 = points.find(p => p.id === 1);
    const p8 = points.find(p => p.id === 8);
    if (p1 && p8) {
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#6B728080";
      ctx.lineWidth = 1;
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p8.x, p8.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw points
    points.forEach(pt => {
      const def = POINTS[pt.id - 1];
      // Outer ring
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = def.color + "30";
      ctx.fill();
      // Filled dot
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = def.color;
      ctx.fill();
      // Number label
      ctx.fillStyle = "white";
      ctx.font = "bold 8px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(pt.id), pt.x, pt.y);
    });
  }, [points, imgReady, canvasSize]);

function getCanvasPos(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (canvas.width  / rect.width),
        y: (e.clientY - rect.top)  * (canvas.height / rect.height),
    };
}

function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const { x, y } = getCanvasPos(e);
    // Check if clicking near an existing point — start drag
    const hit = points.find(p => Math.sqrt((p.x - x) ** 2 + (p.y - y) ** 2) < 14);
    if (hit) {
        setDragging(hit.id);
    return;
    }
    // Place next point
    if (!nextId) return;
    setPoints(prev => [...prev, { id: nextId, x, y }]);
    setResult(null);
}

function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (dragging === null) return;
    const { x, y } = getCanvasPos(e);
    setPoints(prev => prev.map(p => p.id === dragging ? { ...p, x, y } : p));
}

function handleMouseUp() {
    setDragging(null);
}

  function handleCalculate() {
    const res = calcFaceShape(points);
    setResult(res);
  }

  function handleUndo() {
    setPoints(prev => prev.slice(0, -1));
    setResult(null);
  }

  function handleReset() {
    setPoints([]);
    setResult(null);
  }

  if (!photoUrl) {
    return (
      <div style={{ padding: "20px", textAlign: "center", color: "var(--muted)",
        background: "var(--surface)", borderRadius: "8px", border: "1px dashed var(--border)" }}>
        <p style={{ fontSize: "13px" }}>Upload a profile photo above to use this tool</p>
      </div>
    );
  }

  if (!imgReady) {
    return (
      <div style={{ padding: "20px", textAlign: "center", color: "var(--muted)" }}>
        <p style={{ fontSize: "13px" }}>Loading photo…</p>
      </div>
    );
  }

  return (
    <div>
      {/* Step instruction */}
      <div style={{ marginBottom: "14px", padding: "10px 14px",
        background: currentStep ? currentStep.color + "15" : "var(--surface)",
        borderRadius: "8px", border: `1px solid ${currentStep ? currentStep.color + "40" : "var(--border)"}`,
        display: "flex", alignItems: "center", gap: "10px" }}>
        {currentStep ? (
          <>
            <div style={{ width: "22px", height: "22px", borderRadius: "50%",
              background: currentStep.color, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "10px", color: "white", fontWeight: 700 }}>
                {currentStep.id}
              </span>
            </div>
            <div>
              <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--charcoal)", margin: 0 }}>
                Point {currentStep.id} of 8 — {currentStep.label}
              </p>
              <p style={{ fontSize: "12px", color: "var(--muted)", margin: "1px 0 0" }}>
                {currentStep.hint}
              </p>
            </div>
          </>
        ) : (
          <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--charcoal)", margin: 0 }}>
            All 8 points placed — click Calculate below
          </p>
        )}
      </div>

      {/* Side-by-side layout */}
      <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>

        {/* User photo canvas */}
        <div style={{ flex: 1 }}>
          <canvas
              ref={canvasRef}
              width={canvasSize.w}
              height={canvasSize.h}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{
                width: "100%",
                height: "auto",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                cursor: dragging !== null ? "grabbing" : nextId ? "crosshair" : "grab",
                display: "block",
              }}
            />
          {/* Controls */}
          <div style={{ display: "flex", gap: "8px", marginTop: "8px", alignItems: "center" }}>
            <span style={{ fontSize: "12px", color: "var(--muted)", flex: 1 }}>
              {points.length} / 8 points placed
              {points.length > 0 && " · Drag any point to reposition it"}
            </span>
            {points.length > 0 && (
              <button onClick={handleUndo}
                style={{ fontSize: "12px", color: "var(--muted)", background: "none",
                  border: "1px solid var(--border)", borderRadius: "4px",
                  padding: "3px 10px", cursor: "pointer" }}>
                Undo
              </button>
            )}
            {points.length > 1 && (
              <button onClick={handleReset}
                style={{ fontSize: "12px", color: "var(--muted)", background: "none",
                  border: "1px solid var(--border)", borderRadius: "4px",
                  padding: "3px 10px", cursor: "pointer" }}>
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Reference diagram */}
        <ReferenceDiagram />
      </div>

      {/* Calculate button + result */}
      {points.length === 8 && !result && (
        <button onClick={handleCalculate} className="btn-primary"
          style={{ marginTop: "14px", width: "100%" }}>
          Calculate face shape
        </button>
      )}

      {result && (
        <div style={{ marginTop: "14px", padding: "14px 16px", background: "white",
          borderRadius: "8px", border: "1px solid var(--border)",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
          <div>
            <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--charcoal)",
              textTransform: "capitalize", margin: 0 }}>
              {result.shape}
            </p>
            <p style={{ fontSize: "12px", color: "var(--muted)", margin: "2px 0 0" }}>
              {result.desc}
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
            <button onClick={() => { setPoints([]); setResult(null); }}
              style={{ fontSize: "12px", color: "var(--muted)", background: "none",
                border: "1px solid var(--border)", borderRadius: "4px",
                padding: "6px 12px", cursor: "pointer" }}>
              Redo
            </button>
            <button onClick={() => onResult(result.shape)}
              style={{ fontSize: "12px", fontWeight: 600, color: "var(--gold)",
                background: "none", border: "1px solid var(--gold)",
                borderRadius: "4px", padding: "6px 12px", cursor: "pointer",
                textTransform: "capitalize" }}>
              Use {result.shape}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
