/**
 * utils/useImageContentBounds.ts
 * ================================
 * Canvas-based transparent-padding detector for cutout product images.
 *
 * Problem:
 *   Cutout images (transparent-background PNGs) have variable amounts of
 *   transparent space baked in by the photographer / background-removal tool.
 *   When rendered with objectFit:"contain" the transparent halo makes garments
 *   appear much smaller than the container — a dress might fill only 50% of a
 *   container that was sized for it.
 *
 * Solution:
 *   Draw each image onto an off-screen canvas at a small resolution (96px),
 *   scan for the first/last non-transparent row and column, and return the
 *   content bounding box as fractions of the image dimensions.
 *
 *   The caller uses these fractions to expand an inner wrapper div so the
 *   garment content — not the transparent halo — fills the layout container.
 *
 * Fallback hierarchy:
 *   1. Canvas measurement (exact) — used when CORS allows pixel access
 *   2. Category-based estimate (good) — used when canvas access is blocked
 *   3. Zero inset (no adjustment) — used for blob/data URLs (upload mode)
 *
 * CORS note:
 *   Supabase Storage sets Access-Control-Allow-Origin: * by default, so
 *   measurement works out-of-the-box for images hosted there.  For external
 *   CDN images you may need to add crossOrigin handling on the CDN side.
 */

import { useEffect, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContentBounds {
  /** Transparent fraction on the LEFT of the image (0–0.30) */
  left    : number;
  /** Transparent fraction on the TOP of the image (0–0.30) */
  top     : number;
  /** Transparent fraction on the RIGHT of the image (0–0.30) */
  right   : number;
  /** Transparent fraction on the BOTTOM of the image (0–0.30) */
  bottom  : number;
  /** true = canvas measurement succeeded; false = estimate or no measurement */
  measured: boolean;
}

export const NULL_BOUNDS: ContentBounds = {
  left: 0, top: 0, right: 0, bottom: 0, measured: false,
};

// ── Category fallbacks ────────────────────────────────────────────────────────
// Reasonable estimates based on typical product-photo padding.
// Used when canvas pixel access is blocked (cross-origin without CORS headers).

const CATEGORY_FALLBACK: Record<string, ContentBounds> = {
  dresses:    { left: 0.12, top: 0.04, right: 0.12, bottom: 0.04, measured: false },
  set:        { left: 0.12, top: 0.04, right: 0.12, bottom: 0.04, measured: false },
  swimwear:   { left: 0.12, top: 0.04, right: 0.12, bottom: 0.04, measured: false },
  loungewear: { left: 0.11, top: 0.04, right: 0.11, bottom: 0.04, measured: false },
  jumpsuits:  { left: 0.11, top: 0.04, right: 0.11, bottom: 0.04, measured: false },
  tops:       { left: 0.10, top: 0.05, right: 0.10, bottom: 0.05, measured: false },
  bottoms:    { left: 0.10, top: 0.05, right: 0.10, bottom: 0.05, measured: false },
  outerwear:  { left: 0.10, top: 0.03, right: 0.10, bottom: 0.03, measured: false },
  shoes:      { left: 0.08, top: 0.06, right: 0.08, bottom: 0.06, measured: false },
  accessories:{ left: 0.09, top: 0.09, right: 0.09, bottom: 0.09, measured: false },
  jewelry:    { left: 0.11, top: 0.11, right: 0.11, bottom: 0.11, measured: false },
};

function getFallback(category: string): ContentBounds {
  return CATEGORY_FALLBACK[category.toLowerCase()] ?? NULL_BOUNDS;
}

// ── Measurement cache ─────────────────────────────────────────────────────────
// Prevents re-measuring the same URL on every render / remount.

const _cache = new Map<string, ContentBounds>();

// ── Constants ─────────────────────────────────────────────────────────────────

/** Canvas dimension for analysis — small enough to be fast, large enough for accuracy */
const ANALYSIS_PX    = 96;
/** Alpha threshold — pixels below this are considered transparent (0–255) */
const ALPHA_THRESHOLD = 14;
/** Maximum allowed transparent inset on any side — guard against solid-bg images */
const MAX_INSET       = 0.28;

// ── Main hook ─────────────────────────────────────────────────────────────────

/**
 * Returns the transparent-padding fractions for a cutout image.
 *
 * @param src      URL of the cutout image
 * @param category Clothing category (used for fallback estimates)
 * @param enabled  Set to false for non-cutout images (upload mode) to skip measurement
 */
export function useImageContentBounds(
  src     : string,
  category: string,
  enabled : boolean,
): ContentBounds {
  const [bounds, setBounds] = useState<ContentBounds>(
    () => (enabled && !src.startsWith("blob:") && !src.startsWith("data:"))
      ? (_cache.get(src) ?? NULL_BOUNDS)
      : NULL_BOUNDS
  );

  useEffect(() => {
    if (!enabled || !src) { setBounds(NULL_BOUNDS); return; }

    // blob / data URLs are local uploads — photos, not cutouts. No adjustment needed.
    if (src.startsWith("blob:") || src.startsWith("data:")) {
      setBounds(NULL_BOUNDS);
      return;
    }

    // Already measured — use cache
    const cached = _cache.get(src);
    if (cached) { setBounds(cached); return; }

    let cancelled = false;

    const img = new window.Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      if (cancelled) return;

      try {
        const scale = Math.min(1, ANALYSIS_PX / Math.max(img.width, img.height, 1));
        const w = Math.max(1, Math.round(img.width  * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width  = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) { useFallback(); return; }

        ctx.drawImage(img, 0, 0, w, h);

        let pixelData: Uint8ClampedArray;
        try {
          pixelData = ctx.getImageData(0, 0, w, h).data;
        } catch {
          // CORS blocked pixel read — use category fallback
          useFallback();
          return;
        }

        let minX = w, minY = h, maxX = 0, maxY = 0;
        let found = false;

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (pixelData[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
              found = true;
            }
          }
        }

        if (!found) { useFallback(); return; }

        // Raw insets (before clamping)
        const raw: ContentBounds = {
          left   : minX / w,
          top    : minY / h,
          right  : Math.max(0, (w - maxX - 1) / w),
          bottom : Math.max(0, (h - maxY - 1) / h),
          measured: true,
        };

        // Clamp: never report more than MAX_INSET transparent padding on any side.
        // (Solid-background or non-cutout images could otherwise create huge insets.)
        const result: ContentBounds = {
          left   : Math.min(raw.left,   MAX_INSET),
          top    : Math.min(raw.top,    MAX_INSET),
          right  : Math.min(raw.right,  MAX_INSET),
          bottom : Math.min(raw.bottom, MAX_INSET),
          measured: true,
        };

        _cache.set(src, result);
        if (!cancelled) setBounds(result);

      } catch {
        useFallback();
      }
    };

    img.onerror = () => { if (!cancelled) useFallback(); };
    img.src = src;

    function useFallback() {
      const fb = getFallback(category);
      _cache.set(src, fb);
      if (!cancelled) setBounds(fb);
    }

    return () => { cancelled = true; };
  }, [src, category, enabled]);

  return bounds;
}

// ── CSS helpers ───────────────────────────────────────────────────────────────

/**
 * Given measured content bounds, returns the CSS properties for an *inner*
 * wrapper div that should sit inside `position:relative; overflow:hidden`
 * outer container.
 *
 * The inner wrapper expands beyond the outer container so the transparent
 * edges of the cutout are pushed outside (and clipped by overflow:hidden),
 * making the garment content fill the outer container area.
 *
 * Usage:
 *   <div style={{ position:"absolute", ...placement, overflow:"hidden" }}>
 *     <div style={getInnerWrapperStyle(bounds)}>
 *       <Image fill objectFit="contain" />
 *     </div>
 *   </div>
 */
export function getInnerWrapperStyle(bounds: ContentBounds): React.CSSProperties {
  const cW = Math.max(0.45, 1 - bounds.left - bounds.right);
  const cH = Math.max(0.45, 1 - bounds.top  - bounds.bottom);

  return {
    position: "absolute",
    width    : `${(1 / cW) * 100}%`,
    height   : `${(1 / cH) * 100}%`,
    left     : `${(-bounds.left / cW) * 100}%`,
    top      : `${(-bounds.top  / cH) * 100}%`,
  };
}
