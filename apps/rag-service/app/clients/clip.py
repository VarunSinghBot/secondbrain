"""In-process CLIP, replacing clip-sidecar/.

torch/transformers/Pillow live in the optional `clip` dependency group and are only
imported when the model is first used, so the rest of the app and the unit suite never
need them.
"""

import asyncio
import io
import math
import threading
from collections.abc import Callable, Sequence
from typing import Any, Protocol

from app.errors import ClipUnavailableError

CLIP_MODEL_ID = "openai/clip-vit-base-patch32"

TAG_CANDIDATES = [
    "person", "people", "crowd",
    "animal", "dog", "cat", "bird", "wildlife",
    "nature", "forest", "mountain", "beach", "ocean", "sky", "sunset",
    "city", "street", "building", "architecture", "interior",
    "food", "drink", "meal", "restaurant",
    "vehicle", "car", "airplane", "boat",
    "sport", "outdoor activity", "exercise",
    "technology", "computer", "phone", "screen",
    "art", "painting", "drawing", "abstract",
    "document", "text", "diagram", "chart", "graph",
    "medical", "science", "laboratory",
    "fashion", "clothing", "accessories",
    "event", "celebration", "wedding", "conference",
    "landscape", "rural", "urban", "aerial view",
]  # fmt: skip


def normalize(v: Sequence[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in v))
    return [x / norm for x in v] if norm > 0 else list(v)


def rank_tags(
    tags: Sequence[str], scores: Sequence[float], threshold: float, top_k: int
) -> list[str]:
    """Top-k by score first, then drop any below the threshold (the sidecar's order)."""
    ranked = sorted(zip(tags, scores, strict=True), key=lambda ts: ts[1], reverse=True)
    return [tag for tag, score in ranked[:top_k] if score >= threshold]


class ClipBackend(Protocol):
    """Raw (unnormalised) CLIP features. Synchronous; the tagger moves it off the loop."""

    def embed_image(self, image: bytes) -> list[float]: ...

    def embed_texts(self, texts: list[str]) -> list[list[float]]: ...


def _as_tensor(output: Any) -> Any:
    # Depending on the transformers version, get_*_features returns a tensor or a
    # model-output object. The sidecar needed this too.
    if hasattr(output, "shape"):
        return output
    if getattr(output, "pooler_output", None) is not None:
        return output.pooler_output
    if hasattr(output, "last_hidden_state"):
        return output.last_hidden_state[:, 0, :]
    raise ValueError(f"Cannot extract tensor from output type: {type(output)}")


class TransformersClipBackend:
    def __init__(self) -> None:
        import torch
        from transformers import CLIPModel, CLIPProcessor

        self._torch = torch
        self._model = CLIPModel.from_pretrained(CLIP_MODEL_ID)
        self._processor = CLIPProcessor.from_pretrained(CLIP_MODEL_ID)
        self._model.eval()

    def embed_image(self, image: bytes) -> list[float]:
        from PIL import Image

        pil = Image.open(io.BytesIO(image)).convert("RGB")
        inputs = self._processor(images=pil, return_tensors="pt")
        with self._torch.no_grad():
            raw = self._model.get_image_features(**inputs)
        return list(_as_tensor(raw).squeeze().cpu().numpy().tolist())

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        inputs = self._processor(text=texts, return_tensors="pt", padding=True, truncation=True)
        with self._torch.no_grad():
            raw = self._model.get_text_features(**inputs)
        return list(_as_tensor(raw).cpu().numpy().tolist())


class ClipImageTagger:
    """Implements ImageTagger. The model loads on first use; a failed load is retried."""

    def __init__(
        self,
        load: Callable[[], ClipBackend] = TransformersClipBackend,
        threshold: float = 0.19,
        top_n: int = 5,
    ) -> None:
        self._load = load
        self._threshold = threshold
        self._top_n = top_n
        self._backend: ClipBackend | None = None
        self._lock = threading.Lock()
        self._tag_vectors: list[list[float]] | None = None

    def _get_backend(self) -> ClipBackend:
        with self._lock:
            if self._backend is None:
                try:
                    self._backend = self._load()
                except Exception as err:
                    raise ClipUnavailableError(f"CLIP model unavailable: {err}") from err
            return self._backend

    def _embed_image(self, image: bytes) -> list[float]:
        return normalize(self._get_backend().embed_image(image))

    def _embed_text(self, text: str) -> list[float]:
        return normalize(self._get_backend().embed_texts([text])[0])

    def _tag(self, image: bytes) -> list[str]:
        backend = self._get_backend()
        img = normalize(backend.embed_image(image))
        if self._tag_vectors is None:  # the candidate prompts never change
            prompts = [f"a photo of {t}" for t in TAG_CANDIDATES]
            self._tag_vectors = [normalize(v) for v in backend.embed_texts(prompts)]
        scores = [sum(a * b for a, b in zip(img, v, strict=True)) for v in self._tag_vectors]
        return rank_tags(TAG_CANDIDATES, scores, self._threshold, self._top_n)

    async def embed_image(self, image: bytes) -> list[float]:
        return await asyncio.to_thread(self._embed_image, image)

    async def embed_text(self, text: str) -> list[float]:
        if not text.strip():
            raise ValueError("Text cannot be empty")
        return await asyncio.to_thread(self._embed_text, text)

    async def tag_image(self, image: bytes) -> list[str]:
        return await asyncio.to_thread(self._tag, image)
