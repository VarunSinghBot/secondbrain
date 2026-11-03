"""CLIP logic that needs no model: ranking, normalisation, lazy load, failure mapping.

Loading the real model is covered in tests/integration/test_clip_real.py.
"""

from typing import ClassVar

import pytest

from app.clients.clip import TAG_CANDIDATES, ClipImageTagger, normalize, rank_tags
from app.clients.protocols import ImageTagger
from app.errors import ClipUnavailableError


class StubBackend:
    """Stands in for the torch/transformers wrapper."""

    def __init__(self) -> None:
        self.image_calls = 0

    def embed_image(self, image: bytes) -> list[float]:
        self.image_calls += 1
        return [3.0, 4.0]

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [[1.0, 0.0] for _ in texts]


def test_conforms_to_protocol() -> None:
    _: ImageTagger = ClipImageTagger(StubBackend, 0.19, 5)


def test_normalize() -> None:
    assert normalize([3.0, 4.0]) == pytest.approx([0.6, 0.8])


def test_tag_candidates_match_the_sidecar_vocabulary() -> None:
    assert len(TAG_CANDIDATES) == 58
    assert TAG_CANDIDATES[:3] == ["person", "people", "crowd"]
    assert TAG_CANDIDATES[-1] == "aerial view"
    assert len(set(TAG_CANDIDATES)) == len(TAG_CANDIDATES)


def test_rank_tags_returns_at_most_top_k_above_the_threshold() -> None:
    tags = ["a", "b", "c", "d"]
    scores = [0.30, 0.10, 0.25, 0.20]
    assert rank_tags(tags, scores, threshold=0.19, top_k=3) == ["a", "c", "d"]
    assert rank_tags(tags, scores, threshold=0.22, top_k=3) == ["a", "c"]
    assert rank_tags(tags, scores, threshold=0.0, top_k=2) == ["a", "c"]
    assert rank_tags(tags, scores, threshold=0.5, top_k=3) == []


def test_rank_tags_ties_keep_candidate_order() -> None:
    assert rank_tags(["a", "b", "c"], [0.2, 0.2, 0.2], threshold=0.0, top_k=2) == ["a", "b"]


async def test_embed_image_is_normalised_and_backend_loads_lazily_once() -> None:
    loads = 0

    def load() -> StubBackend:
        nonlocal loads
        loads += 1
        return StubBackend()

    tagger = ClipImageTagger(load, 0.19, 5)
    assert loads == 0
    assert await tagger.embed_image(b"x") == pytest.approx([0.6, 0.8])
    await tagger.embed_image(b"y")
    assert loads == 1


async def test_embed_text_rejects_blank_input() -> None:
    with pytest.raises(ValueError, match="Text cannot be empty"):
        await ClipImageTagger(StubBackend, 0.19, 5).embed_text("   ")


async def test_tag_image_scores_against_a_photo_of_prompts() -> None:
    class Backend(StubBackend):
        prompts: ClassVar[list[str]] = []

        def embed_image(self, image: bytes) -> list[float]:
            return [1.0, 0.0]

        def embed_texts(self, texts: list[str]) -> list[list[float]]:
            Backend.prompts = texts
            # Only "dog" points the same way as the image.
            return [[1.0, 0.0] if t == "a photo of dog" else [0.0, 1.0] for t in texts]

    tags = await ClipImageTagger(Backend, threshold=0.19, top_n=5).tag_image(b"x")
    assert tags == ["dog"]
    assert Backend.prompts[0] == "a photo of person"
    assert len(Backend.prompts) == len(TAG_CANDIDATES)


async def test_load_failure_becomes_clip_unavailable_and_retries_next_call() -> None:
    attempts = 0

    def load() -> StubBackend:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise OSError("no weights")
        return StubBackend()

    tagger = ClipImageTagger(load, 0.19, 5)
    with pytest.raises(ClipUnavailableError, match="no weights"):
        await tagger.embed_image(b"x")
    assert await tagger.embed_image(b"x") == pytest.approx([0.6, 0.8])
