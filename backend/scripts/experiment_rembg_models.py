"""
Compare rembg model variants on a small set of local images.

This is a standalone experiment only. It does not change the app pipeline.
"""

from __future__ import annotations

import argparse
import io
from functools import lru_cache
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw
from rembg import new_session, remove


def load_image(path: Path) -> Image.Image:
    with Image.open(path) as img:
        return img.convert("RGB")


def to_bytes(image: Image.Image, fmt: str = "PNG") -> bytes:
    out = io.BytesIO()
    image.save(out, format=fmt)
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


@lru_cache(maxsize=8)
def get_session(model_name: str):
    return new_session(model_name)


def run_cutout(image: Image.Image, model_name: str) -> Image.Image:
    removed = remove(
        to_bytes(image),
        session=get_session(model_name),
        alpha_matting=True,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=10,
        alpha_matting_erode_size=8,
    )
    return trim_rgba(Image.open(io.BytesIO(removed)))


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


def run_experiment(image_path: Path, model_names: list[str], out_dir: Path) -> None:
    original = load_image(image_path)
    stem = image_path.stem

    canvas_size = (300, 420)
    tiles = [annotate_tile(original, "Original", canvas_size)]

    for model_name in model_names:
        cutout = run_cutout(original, model_name)
        cutout_path = out_dir / f"{stem}_{model_name}_cutout.png"
        cutout.save(cutout_path)
        tiles.append(annotate_tile(cutout, model_name, canvas_size))

    board = Image.new("RGBA", (canvas_size[0] * len(tiles), canvas_size[1]), (10, 10, 10, 255))
    for idx, tile in enumerate(tiles):
        board.alpha_composite(tile, (idx * canvas_size[0], 0))

    comparison_path = out_dir / f"{stem}_model_comparison.png"
    board.save(comparison_path)
    print(f"[rembg-models] wrote comparison: {comparison_path}")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare rembg models on local images.")
    parser.add_argument("images", nargs="+", help="Absolute file paths to test images")
    parser.add_argument(
        "--models",
        nargs="+",
        default=["u2net", "u2netp", "isnet-general-use", "silueta"],
        help="rembg model names to compare",
    )
    parser.add_argument(
        "--out-dir",
        default="docs/experiments/rembg-models",
        help="Directory for generated comparison artifacts",
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
        run_experiment(path, args.models, out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
