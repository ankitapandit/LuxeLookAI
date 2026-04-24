"""
ml/embeddings.py — CLIP embedding generation
=============================================
Generates 512-dimensional visual embeddings for clothing images.

In MOCK mode  → returns deterministic random vectors (no GPU / model needed).
In REAL mode  → loads openai/clip-vit-base-patch32 from HuggingFace.

Switch by setting USE_MOCK_AI=false in your .env once you have
the HuggingFace model downloaded or internet access on the server.
"""

from __future__ import annotations
import hashlib
import logging
from typing import List

import numpy as np
from config import get_settings

logger = logging.getLogger(__name__)

# Lazy-loaded real model (only imported when not mocking)
_clip_model = None
_clip_processor = None


def _load_clip():
    """Lazily load the CLIP model so startup is fast during development."""
    global _clip_model, _clip_processor
    if _clip_model is None or _clip_processor is None:
        try:
            from transformers import CLIPModel, CLIPProcessor
            model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
            processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
            # Assign only after both pieces load successfully so we never leave
            # the module in a half-initialized state.
            _clip_model = model
            _clip_processor = processor
        except Exception as e:
            logger.error(f"Failed to load CLIP model: {e}")
            raise


def _mock_embedding(image_url: str) -> List[float]:
    """
    Return a stable 512-dim unit vector derived from the image URL hash.
    This makes the mock deterministic — same URL → same embedding —
    which lets similarity scores behave sensibly in testing.
    """
    seed = int(hashlib.md5(image_url.encode()).hexdigest(), 16) % (2**32)
    rng = np.random.default_rng(seed)
    vec = rng.standard_normal(512).astype(np.float32)
    # Normalise to unit length (cosine similarity works on unit vectors)
    vec /= np.linalg.norm(vec)
    return vec.tolist()


def _real_embedding(image_bytes: bytes) -> List[float]:
    """
    Compute a real CLIP embedding from raw image bytes.
    Returns a 512-dim normalised float list.
    """
    from PIL import Image
    import io
    import torch

    _load_clip()
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    inputs = _clip_processor(images=image, return_tensors="pt")

    with torch.no_grad():
        features = _clip_model.get_image_features(**inputs)

    vec = features.squeeze().numpy()
    vec /= np.linalg.norm(vec)
    return vec.tolist()


def _fallback_embedding_seed(image_url: str, image_bytes: bytes | None) -> str:
    if image_url:
        return image_url
    if image_bytes:
        return f"bytes:{hashlib.md5(image_bytes).hexdigest()}"
    return "embedding-fallback"


def generate_embedding(image_url: str, image_bytes: bytes = None) -> List[float]:
    """
    Public interface for embedding generation.

    Args:
        image_url:   Used as the mock seed OR as a log label in real mode.
        image_bytes: Required when USE_MOCK_AI=false.

    Returns:
        512-dimensional unit-normalised float list.
    """
    settings = get_settings()

    if settings.use_mock_ai:
        return _mock_embedding(image_url)
    else:
        if image_bytes is None:
            raise ValueError("image_bytes required when USE_MOCK_AI=false")
        try:
            return _real_embedding(image_bytes)
        except Exception as e:
            logger.warning(
                "CLIP embedding failed for %s — using deterministic fallback. Reason: %s",
                image_url or "<bytes>",
                e,
            )
            return _mock_embedding(_fallback_embedding_seed(image_url, image_bytes))


def cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    """
    Compute cosine similarity between two embedding vectors.
    Since embeddings are unit-normalised, this is just the dot product.
    Returns a value in [-1, 1]; higher = more visually similar.
    """
    a = np.array(vec_a, dtype=np.float32)
    b = np.array(vec_b, dtype=np.float32)
    return float(np.dot(a, b))
