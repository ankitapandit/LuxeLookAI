/**
 * components/WardrobeItemEditor.tsx
 * ==================================
 * Standalone edit modal for a ClothingItem, reusable from both the wardrobe
 * page and the batch review page.  Mirrors the ItemEditModal in wardrobe.tsx
 * without requiring changes to that file.
 *
 * Props
 * -----
 *   item              — the clothing item to edit
 *   tagOptions        — category / season / formality options (from API)
 *   tagOptionsLoading — true while options are fetching
 *   onRequestTagOptions — call to trigger lazy-load of tag options
 *   onClose           — called when modal is dismissed
 *   onSave            — called with corrected fields; caller handles API call
 *   extraActions      — optional extra buttons shown in the footer (for verify/reject)
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import { CheckCircle, X } from "lucide-react";
import { ClothingItem, TagOptions } from "@/services/api";
import { getItemDisplayName } from "@/utils/itemDisplay";
import {
  SOLID_COLORS,
  CATEGORY_DESCRIPTORS,
  getDescriptorOptionsForCategory,
  sanitizeDescriptorsForCategory,
  getFormalityEditLabel,
  normalizeToPresetKey,
  formatDescriptorLabel,
} from "@/utils/wardrobeHelpers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shouldBypassImageOptimization(src: string): boolean {
  return src.startsWith("blob:") || src.startsWith("data:");
}

function debugWardrobeItemEditor(event: string, details?: Record<string, unknown>) {
  if (details) console.debug(`[BatchUpload][Editor] ${event}`, details);
  else console.debug(`[BatchUpload][Editor] ${event}`);
}

// ─── Internal sub-components ──────────────────────────────────────────────────

function ManagedImage({
  src,
  alt,
  fallbackSrc,
}: {
  src: string;
  alt: string;
  fallbackSrc?: string;
}) {
  const [imgSrc, setImgSrc] = useState(src);
  useEffect(() => setImgSrc(src), [src]);
  return (
    <Image
      src={imgSrc}
      alt={alt}
      fill
      sizes="220px"
      unoptimized={shouldBypassImageOptimization(imgSrc)}
      onError={() => { if (fallbackSrc && imgSrc !== fallbackSrc) setImgSrc(fallbackSrc); }}
      style={{ objectFit: "cover" }}
    />
  );
}

function StyleDetailsSection({
  allDescriptors,
  descriptors,
  onDescriptorChange,
}: {
  allDescriptors: Record<string, string[]>;
  descriptors: Record<string, string>;
  onDescriptorChange: (key: string, val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const filled = Object.values(descriptors).filter(Boolean).length;

  return (
    <div style={{ marginBottom: "20px" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: "6px",
          fontSize: "11px", fontWeight: 600, color: "var(--muted)",
          textTransform: "uppercase", letterSpacing: "0.07em", padding: 0, marginBottom: "10px",
        }}
      >
        Style details
        {filled > 0 && (
          <span style={{ fontSize: "10px", background: "var(--gold)", color: "white", borderRadius: "10px", padding: "1px 6px" }}>
            {filled}
          </span>
        )}
        <span style={{ fontSize: "14px", marginLeft: "2px" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "12px" }}>
          {Object.entries(allDescriptors).map(([key, options]) => (
            <div key={key}>
              <label
                htmlFor={`editor-desc-${key}`}
                style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "capitalize", display: "block", marginBottom: "4px" }}
              >
                {formatDescriptorLabel(key)}
              </label>
              <select
                id={`editor-desc-${key}`}
                value={descriptors[key] || ""}
                onChange={(e) => onDescriptorChange(key, e.target.value)}
                className="input"
                style={{ padding: "7px 10px", fontSize: "13px", textTransform: "capitalize" }}
              >
                <option value="">—</option>
                {options.map((o) => (
                  <option key={o} value={o} style={{ textTransform: "capitalize" }}>{o}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface WardrobeItemEditorProps {
  item: ClothingItem;
  tagOptions: TagOptions;
  tagOptionsLoading: boolean;
  onRequestTagOptions: () => Promise<void> | void;
  onClose: () => void;
  /** Called with the corrected values when user presses Save. */
  onSave: (
    cat: string,
    color: string,
    pattern: string,
    season: string,
    formalityLabel: string,
    descriptors: Record<string, string>
  ) => void;
  /**
   * Optional extra action buttons rendered in the modal footer.
   * Useful in the batch review context for Verify / Reject.
   */
  extraActions?: React.ReactNode;
}

export default function WardrobeItemEditor({
  item,
  tagOptions,
  tagOptionsLoading,
  onRequestTagOptions,
  onClose,
  onSave,
  extraActions,
}: WardrobeItemEditorProps) {
  const [editCat,           setEditCat]           = useState(item.category);
  const [editColor,         setEditColor]         = useState(item.color || "");
  const [editSeason,        setEditSeason]        = useState(item.season || "");
  const [editFormalityLabel, setEditFormalityLabel] = useState(getFormalityEditLabel(item.formality_score));
  const [editDescriptors,   setEditDescriptors]   = useState<Record<string, string>>(
    sanitizeDescriptorsForCategory(item.category, item.descriptors || {})
  );
  const editPattern = item.pattern || "";

  // Reset when item changes
  useEffect(() => {
    setEditCat(item.category);
    setEditColor(item.color || "");
    setEditSeason(item.season || "");
    setEditFormalityLabel(getFormalityEditLabel(item.formality_score));
    setEditDescriptors(sanitizeDescriptorsForCategory(item.category, item.descriptors || {}));
    debugWardrobeItemEditor("item_loaded", { itemId: item.id, category: item.category, color: item.color || "", descriptorCount: Object.keys(item.descriptors || {}).length });
  }, [item]);

  // When category changes, sanitize descriptors for the new category
  useEffect(() => {
    setEditDescriptors((prev) => sanitizeDescriptorsForCategory(editCat, prev));
  }, [editCat]);

  // Lazy-load tag options
  useEffect(() => {
    debugWardrobeItemEditor("request_tag_options");
    void onRequestTagOptions();
  }, [onRequestTagOptions]);

  const activeColorKey = editColor === ""
    ? null
    : SOLID_COLORS.some((c) => c.key === editColor)
      ? editColor
      : normalizeToPresetKey(editColor);

  const categoryOptions = tagOptions.categories.length > 0
    ? tagOptions.categories
    : [editCat].filter(Boolean);
  const seasonOptions = tagOptions.seasons.length > 0
    ? tagOptions.seasons
    : [{ value: editSeason || "all", label: editSeason || "All seasons" }];
  const formalityOptions = tagOptions.formality_levels.length > 0
    ? tagOptions.formality_levels
    : [{ label: editFormalityLabel || "Casual", score: 0.3, description: "" }];

  const allDescriptors = getDescriptorOptionsForCategory(editCat, editDescriptors);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000 }}
      />

      {/* Modal */}
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 1001, background: "var(--surface)", borderRadius: "12px",
        width: "min(760px, 94vw)", maxHeight: "88vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.25)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div>
            <p style={{ fontWeight: 600, fontSize: "15px", color: "var(--charcoal)" }}>Edit Tags</p>
            <p style={{ color: "var(--muted)", fontSize: "12px", textTransform: "capitalize" }}>
              {getItemDisplayName(item)}
            </p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: "4px" }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px", overflowY: "auto", flex: 1 }}>
          <div style={{ display: "flex", gap: "20px", alignItems: "flex-start", flexWrap: "wrap" }}>
            {/* Thumbnail */}
            <div style={{ flex: "0 0 220px", width: "220px", maxWidth: "100%", margin: "0 auto" }}>
              <div style={{ position: "sticky", top: 0 }}>
                <div style={{ width: "100%", aspectRatio: "3 / 4", position: "relative", borderRadius: "12px", overflow: "hidden", background: "var(--input-bg)", border: "1px solid var(--border)" }}>
                  <ManagedImage
                    src={item.thumbnail_url || item.image_url}
                    alt={`${item.category} reference`}
                    fallbackSrc={`https://placehold.co/300x400/F5F0E8/8A8580?text=${encodeURIComponent(item.category)}`}
                  />
                </div>
                <p style={{ fontSize: "12px", color: "var(--muted)", marginTop: "10px", lineHeight: 1.4 }}>
                  Reference image for category, colour, and style detail edits.
                </p>
              </div>
            </div>

            {/* Fields */}
            <div style={{ flex: "1 1 340px", minWidth: "280px" }}>
              {/* Category */}
              <label htmlFor="weditor-category" style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: "6px" }}>
                Category
              </label>
              <select
                id="weditor-category"
                value={editCat}
                onChange={(e) => setEditCat(e.target.value)}
                disabled={tagOptionsLoading && tagOptions.categories.length === 0}
                className="input"
                style={{ padding: "8px 12px", fontSize: "14px", marginBottom: "20px", textTransform: "capitalize" }}
              >
                {categoryOptions.map((c) => (
                  <option key={c} value={c} style={{ textTransform: "capitalize" }}>{c}</option>
                ))}
              </select>

              {/* Season + Formality row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", marginBottom: "20px" }}>
                <div>
                  <label htmlFor="weditor-season" style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: "6px" }}>
                    Season
                  </label>
                  <select
                    id="weditor-season"
                    value={editSeason}
                    onChange={(e) => setEditSeason(e.target.value)}
                    className="input"
                    style={{ padding: "8px 12px", fontSize: "14px", textTransform: "capitalize" }}
                  >
                    {seasonOptions.map((o) => (
                      <option key={o.value} value={o.value} style={{ textTransform: "capitalize" }}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="weditor-formality" style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: "6px" }}>
                    Dress Code
                  </label>
                  <select
                    id="weditor-formality"
                    value={editFormalityLabel}
                    onChange={(e) => setEditFormalityLabel(e.target.value)}
                    className="input"
                    style={{ padding: "8px 12px", fontSize: "14px" }}
                  >
                    {formalityOptions.map((o) => (
                      <option key={o.label} value={o.label}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Color swatches */}
              <label style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: "8px" }}>
                Colour
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                {SOLID_COLORS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    title={c.label}
                    onClick={() => setEditColor(c.key)}
                    style={{
                      width: "26px", height: "26px", borderRadius: "50%", background: c.hex,
                      border: activeColorKey === c.key ? "3px solid var(--charcoal)" : "2px solid transparent",
                      outline: activeColorKey === c.key ? "2px solid var(--cream)" : "none",
                      cursor: "pointer",
                      transform: activeColorKey === c.key ? "scale(1.15)" : "scale(1)",
                      transition: "transform 0.1s ease",
                    }}
                  />
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                <input
                  type="color"
                  value={editColor.startsWith("#") ? editColor : "#ffffff"}
                  onChange={(e) => setEditColor(e.target.value)}
                  style={{ width: "32px", height: "32px", border: "1px solid var(--border)", borderRadius: "6px", cursor: "pointer", padding: "2px" }}
                />
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>or pick custom</span>
              </div>

              {/* Style details */}
              {Object.keys(allDescriptors).length > 0 && (
                <StyleDetailsSection
                  allDescriptors={allDescriptors}
                  descriptors={editDescriptors}
                  onDescriptorChange={(key, val) => setEditDescriptors((prev) => ({ ...prev, [key]: val }))}
                />
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: "8px", flexShrink: 0, background: "var(--surface)", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              debugWardrobeItemEditor("save_clicked", {
                itemId: item.id,
                category: editCat,
                color: editColor,
                season: editSeason,
                formalityLabel: editFormalityLabel,
                descriptorCount: Object.keys(editDescriptors).length,
              });
              onSave(editCat, editColor, editPattern, editSeason, editFormalityLabel, editDescriptors);
            }}
            className="btn-primary"
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <CheckCircle size={14} /> Save
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          {extraActions}
        </div>
      </div>
    </>
  );
}
