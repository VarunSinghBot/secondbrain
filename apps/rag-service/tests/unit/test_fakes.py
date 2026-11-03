"""mypy checks these assignments: every fake must satisfy its Protocol."""

import pytest

from app.clients.protocols import (
    LLM,
    DocumentParser,
    Embedder,
    ImageTagger,
    MediaStore,
    OcrEngine,
    Transcriber,
    VectorStore,
)
from tests.fakes import (
    FakeDocumentParser,
    FakeEmbedder,
    FakeImageTagger,
    FakeLLM,
    FakeMediaStore,
    FakeOcr,
    FakeTranscriber,
    FakeVectorStore,
)


def test_every_fake_satisfies_its_protocol() -> None:
    _embedder: Embedder = FakeEmbedder()
    _store: VectorStore = FakeVectorStore()
    _llm: LLM = FakeLLM()
    _asr: Transcriber = FakeTranscriber()
    _parser: DocumentParser = FakeDocumentParser()
    _ocr: OcrEngine = FakeOcr()
    _clip: ImageTagger = FakeImageTagger()
    _media: MediaStore = FakeMediaStore()


async def test_fake_embeddings_are_deterministic_unit_vectors_and_batch_matches_single() -> None:
    e = FakeEmbedder(dim=16)
    single = await e.embed_text("hello", "RETRIEVAL_DOCUMENT")
    (batched,) = await e.embed_batch(["hello"], "RETRIEVAL_DOCUMENT")
    assert single == batched
    assert sum(x * x for x in single) == pytest.approx(1.0)
    assert single != await e.embed_text("goodbye", "RETRIEVAL_DOCUMENT")
