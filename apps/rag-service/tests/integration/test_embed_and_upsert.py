"""Gemini embeds, Qdrant stores and finds it again. Needs GEMINI_API_KEY and a local Qdrant."""

import math
import uuid

import httpx
import pytest

from app.clients.gemini import GeminiEmbedder
from app.clients.protocols import VectorPoint
from app.clients.qdrant import QdrantVectorStore
from app.config import Settings

NOTES = [
    "Mitochondria are the powerhouse of the cell and produce ATP.",
    "The 2019 budget meeting moved the product launch to September.",
    "Sourdough needs a long fermentation and a very hot oven.",
]


@pytest.fixture
def embedder(settings: Settings) -> GeminiEmbedder:
    if not settings.gemini_api_key:
        pytest.skip("GEMINI_API_KEY not set")
    return GeminiEmbedder(
        httpx.AsyncClient(timeout=60),
        settings.gemini_api_key,
        settings.embedding_model,
        settings.qdrant_vector_size,
    )


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))


async def test_batch_vectors_match_single_vectors(embedder: GeminiEmbedder) -> None:
    batch = await embedder.embed_batch(NOTES, "RETRIEVAL_DOCUMENT")
    for text, vec in zip(NOTES, batch, strict=True):
        single = await embedder.embed_text(text, "RETRIEVAL_DOCUMENT")
        assert len(vec) == 768
        assert math.isclose(sum(x * x for x in vec), 1.0, abs_tol=1e-6)
        assert cosine(vec, single) > 0.9999


async def test_embed_upsert_search_round_trip(
    embedder: GeminiEmbedder, qdrant_store: QdrantVectorStore
) -> None:
    vectors = await embedder.embed_batch(NOTES, "RETRIEVAL_DOCUMENT")
    points = [
        VectorPoint(str(uuid.uuid4()), v, {"userId": "u1", "contentId": f"c{i}", "text": t})
        for i, (t, v) in enumerate(zip(NOTES, vectors, strict=True))
    ]
    await qdrant_store.upsert_text(points)

    query = await embedder.embed_text("what does the cell use to make energy?", "RETRIEVAL_QUERY")
    hits = await qdrant_store.search_text(query, "u1", limit=3)

    assert len(hits) == 3
    assert hits[0].payload["contentId"] == "c0"
    assert hits[0].score > hits[1].score
