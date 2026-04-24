"""
Standalone shadow-aware cutout experiment.

This script compares the current baseline cutout path with a prototype
preprocessing step intended to soften likely background shadows in manually
captured hanger photos before running `rembg`.

It is intentionally isolated from the app runtime so we can evaluate the idea
on a few local files first.
"""

from __future__ import annotations

import argparse
import io
from pathlib import Path
from typing import Iterable, Literal

import cv2
import numpy as np
from PIL import Image, ImageDraw
from rembg import new_session, remove


SESSION = new_session("u2net")


def load_rgb(path: Path) -> np.ndarray:
    with Image.open(path) as img:
        img = img.convert("RGB")
        return np.array(img)


def pil_to_bytes(image: Image.Image, fmt: str = "PNG", **save_kwargs) -> bytes:
    out = io.BytesIO()
    image.save(out, format=fmt, **save_kwargs)
    return out.getvalue()


def trim_rgba(image: Image.Image, max_size: int = 900) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    bbox = alpha.getbbox()
    if bbox:
        pad_x = max(10, int((bbox[2] - bbox[0]) * 0.08))
        pad_y = max(10, int((bbox[3] - bbox[1]) * 0.08))
        bbox = (
            max(0, bbox[0] - pad_x),
            max(0, bbox[1] - pad_y),
            min(rgba.width, bbox[2] + pad_x),
            min(rgba.height, bbox[3] + pad_y),
        )
        rgba = rgba.crop(bbox)

    rgba.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    return rgba


def run_baseline_cutout(rgb: np.ndarray) -> Image.Image:
    raw = pil_to_bytes(Image.fromarray(rgb), fmt="PNG")
    removed = remove(
        raw,
        session=SESSION,
        alpha_matting=True,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=10,
        alpha_matting_erode_size=8,
    )
    return trim_rgba(Image.open(io.BytesIO(removed)))


def estimate_background_lab(lab: np.ndarray) -> np.ndarray:
    h, w = lab.shape[:2]
    strip = max(10, int(min(h, w) * 0.06))
    border = np.concatenate(
        [
            lab[:strip, :, :].reshape(-1, 3),
            lab[-strip:, :, :].reshape(-1, 3),
            lab[:, :strip, :].reshape(-1, 3),
            lab[:, -strip:, :].reshape(-1, 3),
        ],
        axis=0,
    )
    # Trim away the darkest border samples so the top hanger does not pull the
    # estimated wall color downward.
    lightness = border[:, 0]
    keep = border[lightness >= np.percentile(lightness, 35)]
    if keep.size == 0:
        keep = border
    return np.median(keep, axis=0).astype(np.float32)


def build_shadow_mask_v1(rgb: np.ndarray) -> np.ndarray:
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    bg_lab = estimate_background_lab(lab)
    bg_l = bg_lab[0]
    bg_ab = bg_lab[1:]

    l = lab[:, :, 0]
    ab = lab[:, :, 1:]
    sat = hsv[:, :, 1]

    # Background-like pixels that are darker than the wall/door.
    delta_l = bg_l - l
    chroma_dist = np.linalg.norm(ab - bg_ab, axis=2)

    # Cast shadows usually have soft edges and low local detail compared with
    # actual garment structure like straps or prints.
    blur = cv2.GaussianBlur(gray, (0, 0), 3.0)
    gradient = cv2.Laplacian(blur, cv2.CV_32F, ksize=3)
    grad_mag = np.abs(gradient)
    texture = cv2.GaussianBlur(np.abs(gray.astype(np.float32) - blur.astype(np.float32)), (0, 0), 3.0)

    shadow_like = (
        (delta_l > 12) &
        (delta_l < 90) &
        (chroma_dist < 20) &
        (sat < 70) &
        (grad_mag < 18) &
        (texture < 18)
    )

    mask = (shadow_like.astype(np.uint8) * 255)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.GaussianBlur(mask, (0, 0), 5.0)
    return mask


def build_shadow_mask_v2(rgb: np.ndarray) -> np.ndarray:
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)

    bg_lab = estimate_background_lab(lab)
    bg_l = bg_lab[0]
    bg_ab = bg_lab[1:]

    l = lab[:, :, 0].astype(np.uint8)
    ab = lab[:, :, 1:]

    # Adaptive threshold over inverse lightness to identify locally darker
    # regions instead of relying on one global darkness cutoff.
    inv_l = 255 - l
    adaptive = cv2.adaptiveThreshold(
        inv_l,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        41,
        -6,
    )

    delta_l = bg_l - lab[:, :, 0]
    chroma_dist = np.linalg.norm(ab - bg_ab, axis=2)

    blur = cv2.GaussianBlur(gray, (0, 0), 3.0)
    sobel_x = cv2.Sobel(blur, cv2.CV_32F, 1, 0, ksize=3)
    sobel_y = cv2.Sobel(blur, cv2.CV_32F, 0, 1, ksize=3)
    edge_strength = cv2.magnitude(sobel_x, sobel_y)
    local_texture = cv2.GaussianBlur(np.abs(gray - blur), (0, 0), 3.0)

    shadow_like = (
        (adaptive > 0) &
        (delta_l > 8) &
        (delta_l < 80) &
        (chroma_dist < 18) &
        (edge_strength < 26) &
        (local_texture < 16)
    )

    mask = (shadow_like.astype(np.uint8) * 255)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.GaussianBlur(mask, (0, 0), 4.0)
    return mask


def suppress_shadow(
    rgb: np.ndarray,
    variant: Literal["v1", "v2"] = "v1",
) -> tuple[np.ndarray, np.ndarray]:
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    if variant == "v2":
        mask = build_shadow_mask_v2(rgb).astype(np.float32) / 255.0
    else:
        mask = build_shadow_mask_v1(rgb).astype(np.float32) / 255.0

    bg_lab = estimate_background_lab(lab)
    bg_l = bg_lab[0]

    # Brighten only toward the estimated background lightness and leave chroma
    # mostly intact. The multiplier is intentionally conservative.
    strength = np.clip(mask * 0.85, 0.0, 0.85)
    l = lab[:, :, 0]
    lifted_l = l + (bg_l - l) * strength
    lab[:, :, 0] = np.clip(lifted_l, 0, 255)

    corrected = cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2RGB)
    return corrected, (mask * 255).astype(np.uint8)


def run_shadow_aware_cutout(
    rgb: np.ndarray,
    variant: Literal["v1", "v2"] = "v1",
) -> tuple[Image.Image, np.ndarray, np.ndarray]:
    corrected, shadow_mask = suppress_shadow(rgb, variant=variant)
    cutout = run_baseline_cutout(corrected)
    return cutout, corrected, shadow_mask


def annotate_tile(image: Image.Image, label: str, canvas_size: tuple[int, int]) -> Image.Image:
    tile = Image.new("RGBA", canvas_size, (15, 14, 11, 255))
    working = image.convert("RGBA")
    working.thumbnail((canvas_size[0] - 32, canvas_size[1] - 54), Image.Resampling.LANCZOS)
    x = (canvas_size[0] - working.width) // 2
    y = 18 + (canvas_size[1] - 54 - working.height) // 2
    tile.alpha_composite(working, (x, y))
    draw = ImageDraw.Draw(tile)
    draw.text((16, canvas_size[1] - 28), label, fill=(240, 235, 226, 255))
    return tile


def mask_to_tile(mask: np.ndarray, label: str, canvas_size: tuple[int, int]) -> Image.Image:
    mask_img = Image.fromarray(mask, mode="L").convert("RGBA")
    return annotate_tile(mask_img, label, canvas_size)


def save_comparison(
    out_dir: Path,
    stem: str,
    variant: str,
    original_rgb: np.ndarray,
    corrected_rgb: np.ndarray,
    shadow_mask: np.ndarray,
    baseline_cutout: Image.Image,
    experimental_cutout: Image.Image,
) -> Path:
    canvas_size = (300, 420)
    row = [
        annotate_tile(Image.fromarray(original_rgb), "Original", canvas_size),
        annotate_tile(Image.fromarray(corrected_rgb), "Shadow-suppressed", canvas_size),
        mask_to_tile(shadow_mask, "Shadow mask", canvas_size),
        annotate_tile(baseline_cutout, "Baseline cutout", canvas_size),
        annotate_tile(experimental_cutout, "Experimental cutout", canvas_size),
    ]
    total = Image.new("RGBA", (canvas_size[0] * len(row), canvas_size[1]), (10, 10, 10, 255))
    for idx, tile in enumerate(row):
        total.alpha_composite(tile, (idx * canvas_size[0], 0))
    path = out_dir / f"{stem}_{variant}_comparison.png"
    total.save(path)
    return path


def run_experiment(path: Path, out_dir: Path, variant: Literal["v1", "v2"]) -> None:
    rgb = load_rgb(path)
    baseline = run_baseline_cutout(rgb)
    experimental_cutout, corrected_rgb, shadow_mask = run_shadow_aware_cutout(rgb, variant=variant)

    stem = path.stem
    Image.fromarray(corrected_rgb).save(out_dir / f"{stem}_{variant}_shadow_suppressed.png")
    Image.fromarray(shadow_mask).save(out_dir / f"{stem}_{variant}_shadow_mask.png")
    baseline.save(out_dir / f"{stem}_baseline_cutout.png")
    experimental_cutout.save(out_dir / f"{stem}_{variant}_experimental_cutout.png")
    comparison_path = save_comparison(
        out_dir,
        stem,
        variant,
        rgb,
        corrected_rgb,
        shadow_mask,
        baseline,
        experimental_cutout,
    )
    print(f"[shadow-cutout] wrote comparison: {comparison_path}")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a shadow-aware cutout experiment on local images.")
    parser.add_argument("images", nargs="+", help="Absolute file paths to test images")
    parser.add_argument(
        "--out-dir",
        default="docs/experiments/shadow-cutout",
        help="Directory for generated comparison artifacts",
    )
    parser.add_argument(
        "--variant",
        choices=("v1", "v2"),
        default="v1",
        help="Shadow-masking experiment variant to run",
    )
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    for raw in args.images:
        path = Path(raw).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"Image not found: {path}")
        run_experiment(path, out_dir, variant=args.variant)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
