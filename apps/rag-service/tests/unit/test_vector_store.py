from collections.abc import AsyncIterator

import pytest
from qdrant_client import AsyncQdrantClient

from app.clients.protocols import VectorStore
from app.clients.qdrant import QdrantVectorStore
from tests.fakes import FakeVectorStore
from tests.vector_store_contract import VectorStoreContract


class TestFakeVectorStore(VectorStoreContract):
    @pytest.fixture
    async def store(self) -> VectorStore:
        return FakeVectorStore()


class TestQdrantVectorStoreInMemory(VectorStoreContract):
    """The real wrapper over qdrant-client's offline in-memory engine."""

    @pytest.fixture
    async def store(self) -> AsyncIterator[VectorStore]:
        client = AsyncQdrantClient(":memory:")
        yield QdrantVectorStore(client, "rag_text", "rag_images", text_vector_size=768)
        await client.close()


async def test_ensure_collections_recreates_on_size_mismatch() -> None:
    client = AsyncQdrantClient(":memory:")
    old = QdrantVectorStore(client, "rag_text", "rag_images", text_vector_size=384)
    await old.ensure_collections()
    await QdrantVectorStore(
        client, "rag_text", "rag_images", text_vector_size=768
    ).ensure_collections()
    info = await client.get_collection("rag_text")
    assert info.config.params.vectors.size == 768  # type: ignore[union-attr]
    await client.close()


async def test_ensure_collections_only_checks_once_per_store() -> None:
    client = AsyncQdrantClient(":memory:")
    store = QdrantVectorStore(client, "rag_text", "rag_images", text_vector_size=768)
    await store.ensure_collections()
    await client.delete_collection("rag_text")
    await store.ensure_collections()  # cached: does not recreate
    assert not await client.collection_exists("rag_text")
    await client.close()
