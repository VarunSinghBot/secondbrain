"""Integration fixtures. Select with `-m integration`; deselect with `-m "not integration"`.

Qdrant: QDRANT_TEST_URL (default http://localhost:6335, see docker-compose.rag-service.yml).
Collections are uniquely named per test and dropped afterwards, so the real rag_text and
rag_images are never touched. Tests skip, not fail, when a service is not available.
"""

import os
import uuid
from collections.abc import AsyncIterator

import httpx
import pytest
from qdrant_client import AsyncQdrantClient

from app.clients.qdrant import QdrantVectorStore
from app.config import Settings

QDRANT_TEST_URL = os.environ.get("QDRANT_TEST_URL", "http://localhost:6335")


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    for item in items:
        if "integration" in str(item.path):
            item.add_marker(pytest.mark.integration)


@pytest.fixture
def settings() -> Settings:
    return Settings()


@pytest.fixture
async def qdrant_client() -> AsyncIterator[AsyncQdrantClient]:
    try:
        httpx.get(QDRANT_TEST_URL, timeout=2).raise_for_status()
    except httpx.HTTPError:
        pytest.skip(f"no Qdrant at {QDRANT_TEST_URL}")
    client = AsyncQdrantClient(url=QDRANT_TEST_URL, check_compatibility=False)
    yield client
    await client.close()


@pytest.fixture
async def qdrant_store(qdrant_client: AsyncQdrantClient) -> AsyncIterator[QdrantVectorStore]:
    run = uuid.uuid4().hex[:8]
    store = QdrantVectorStore(
        qdrant_client, f"it_text_{run}", f"it_images_{run}", text_vector_size=768
    )
    yield store
    for name in (store.text_collection, store.image_collection):
        await qdrant_client.delete_collection(name)
