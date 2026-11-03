import pytest

from app.clients.protocols import VectorStore
from app.clients.qdrant import QdrantVectorStore
from tests.vector_store_contract import VectorStoreContract


class TestQdrantServer(VectorStoreContract):
    """The same contract the fake and in-memory engine pass, against a real server."""

    @pytest.fixture
    def store(self, qdrant_store: QdrantVectorStore) -> VectorStore:
        return qdrant_store
