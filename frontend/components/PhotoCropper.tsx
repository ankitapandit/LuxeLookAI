/**
 * components/PhotoCropper.tsx
 * Canvas-based inline photo cropper with pan and zoom.
 * Shows a circular crop overlay matching the profile photo circle.
 * No external dependencies.
 */

import { useEffect, useRef, useState, useCallback } from "react";

interface PhotoCropperProps {
  file: File;
  onCrop: (blob: Blob) => void;
  onCancel: () => void;
}

const CANVAS_SIZE  = 320;   // canvas width and height in px
const CROP_RADIUS  = 140;   // circular crop area radius
const CROP_CENTER  = CANVAS_SIZE / 2;
const MIN_ZOOM     = 0.1;
const MAX_ZOOM     = 4.0;
const ZOOM_STEP    = 0.15;

export function PhotoCropper({ file, onCrop, onCancel }: PhotoCropperProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const imgRef     = useRef<HTMLImageElement | null>(null);
  const [zoom,     setZoom]     = useState(1);
  const [offset,   setOffset]   = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imgReady, setImgReady] = useState(false);

  // Load the file as an image
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;

      // Initial zoom: Fit the entire image within the canvas at start so user sees full photo
      const scaleToFitW = CANVAS_SIZE / img.naturalWidth;
      const scaleToFitH = CANVAS_SIZE / img.naturalHeight;
      const initialZoom = Math.min(scaleToFitW, scaleToFitH);
      setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, initialZoom)));
      setOffset({ x: 0, y: 0 });
      setImgReady(true);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }, [file]);

  // Draw canvas whenever zoom, offset or image changes
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img || !imgReady) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Draw image centered with zoom and pan offset
    const drawW = img.naturalWidth  * zoom;
    const drawH = img.naturalHeight * zoom;
    const drawX = CROP_CENTER - drawW / 2 + offset.x;
    const drawY = CROP_CENTER - drawH / 2 + offset.y;

    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    // Dimmed overlay outside circle — use clip path instead of compositing
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.arc(CROP_CENTER, CROP_CENTER, CROP_RADIUS, 0, Math.PI * 2, true); // true = counterclockwise cuts hole
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fill("evenodd");
    ctx.restore();

    // Circle border
    ctx.beginPath();
    ctx.arc(CROP_CENTER, CROP_CENTER, CROP_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [zoom, offset, imgReady]);

  useEffect(() => { draw(); }, [draw]);

  // Mouse handlers for panning
  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    setDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragging) return;
    setOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  }

  function handleMouseUp() { setDragging(false); }

  // Touch handlers for mobile panning
  function handleTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    const touch = e.touches[0];
    setDragging(true);
    setDragStart({ x: touch.clientX - offset.x, y: touch.clientY - offset.y });
  }

  function handleTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    if (!dragging) return;
    const touch = e.touches[0];
    setOffset({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y,
    });
  }

  // Scroll wheel zoom
  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom(z => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)));
  }

  function handleZoomIn()  { setZoom(z => Math.min(MAX_ZOOM, z + ZOOM_STEP)); }
  function handleZoomOut() { setZoom(z => Math.max(MIN_ZOOM, z - ZOOM_STEP)); }

  // Crop and export
  function handleCrop() {
    const img = imgRef.current;
    if (!img) return;

    // Create output canvas — circular crop at 300×300
    const out = document.createElement("canvas");
    out.width  = CROP_RADIUS * 2;
    out.height = CROP_RADIUS * 2;
    const ctx = out.getContext("2d");
    if (!ctx) return;

    // Clip to circle
    ctx.beginPath();
    ctx.arc(CROP_RADIUS, CROP_RADIUS, CROP_RADIUS, 0, Math.PI * 2);
    ctx.clip();

    // Draw the same region that's visible in the crop circle
    const drawW = img.naturalWidth  * zoom;
    const drawH = img.naturalHeight * zoom;
    const drawX = CROP_CENTER - drawW / 2 + offset.x - (CROP_CENTER - CROP_RADIUS);
    const drawY = CROP_CENTER - drawH / 2 + offset.y - (CROP_CENTER - CROP_RADIUS);

    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    out.toBlob(blob => {
      if (blob) onCrop(blob);
    }, "image/jpeg", 0.92);
  }

  return (
    // <div style={{
    //   marginTop: "16px", padding: "20px",
    //   background: "var(--surface)", borderRadius: "12px",
    //   border: "1px solid var(--border)",
    // }}>
      <div>
      <p style={{ fontSize: "13px", color: "var(--charcoal)", fontWeight: 600, marginBottom: "4px" }}>
        Adjust your photo
      </p>
      <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "16px" }}>
        Drag to reposition · Scroll or use buttons to zoom
      </p>

      {/* Canvas */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseUp}
          onWheel={handleWheel}
          style={{
            borderRadius: "8px",
            cursor: dragging ? "grabbing" : "grab",
            display: "block",
            maxWidth: "100%",
          }}
        />
      </div>

      {/* Zoom controls */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", marginBottom: "16px" }}>
        <button onClick={handleZoomOut} disabled={zoom <= MIN_ZOOM}
          style={{
            width: "32px", height: "32px", borderRadius: "50%",
            border: "1px solid var(--border)", background: "white",
            fontSize: "18px", cursor: "pointer", color: "var(--charcoal)",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: zoom <= MIN_ZOOM ? 0.4 : 1,
          }}>
          −
        </button>
        <div style={{ width: "120px" }}>
          <input type="range"
            min={MIN_ZOOM * 100} max={MAX_ZOOM * 100} value={zoom * 100}
            onChange={e => setZoom(parseInt(e.target.value) / 100)}
            style={{ width: "100%", accentColor: "var(--gold)" }}
          />
        </div>
        <button onClick={handleZoomIn} disabled={zoom >= MAX_ZOOM}
          style={{
            width: "32px", height: "32px", borderRadius: "50%",
            border: "1px solid var(--border)", background: "white",
            fontSize: "18px", cursor: "pointer", color: "var(--charcoal)",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: zoom >= MAX_ZOOM ? 0.4 : 1,
          }}>
          +
        </button>
        <span style={{ fontSize: "12px", color: "var(--muted)", minWidth: "36px" }}>
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "10px" }}>
        <button onClick={onCancel}
          style={{
            flex: 1, padding: "10px", borderRadius: "8px",
            border: "1px solid var(--border)", background: "white",
            fontSize: "14px", cursor: "pointer", color: "var(--muted)",
          }}>
          Cancel
        </button>
        <button onClick={handleCrop}
          style={{
            flex: 2, padding: "10px", borderRadius: "8px",
            border: "none", background: "var(--charcoal)",
            fontSize: "14px", fontWeight: 600, cursor: "pointer", color: "white",
          }}>
          Crop & Upload
        </button>
      </div>
    </div>
  );
}