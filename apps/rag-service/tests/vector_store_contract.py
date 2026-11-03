"""Behaviour every VectorStore must have. Subclass and provide a `store` fixture.

Runs against the fake and qdrant-client's in-memory mode in the unit suite, and
against a real Qdrant server in tests/integration.
"""

import uuid

import pytest

from app.clients.protocols import VectorPoint, VectorStore
from tests.fakes import payload

TEXT_DIM = 768
IMAGE_DIM = 512


def axis(i: int, dim: int) -> list[float]:
    v = [0.0] * dim
    v[i] = 1.0
    return v


def pt(i: int, dim: int, user: str, content: str, **extra: object) -> VectorPoint:
    return VectorPoint(str(uuid.uuid4()), axis(i, dim), payload(user, content, **extra))


class VectorStoreContract:
    async def test_ensure_collections_is_idempotent(self, store: VectorStore) -> None:
        await store.ensure_collections()
        await store.ensure_collections()

    async def test_search_orders_by_similarity(self, store: VectorStore) -> None:
        a, b = pt(0, TEXT_DIM, "u1", "c1"), pt(1, TEXT_DIM, "u1", "c2")
        await store.upsert_text([a, b])
        hits = await store.search_text(axis(1, TEXT_DIM), "u1", limit=5)
        assert [h.id for h in hits] == [b.id, a.id]
        assert hits[0].score == pytest.approx(1.0, abs=1e-4)
        assert hits[1].score == pytest.approx(0.0, abs=1e-4)
        assert hits[0].payload["contentId"] == "c2"

    async def test_search_is_scoped_to_user(self, store: VectorStore) -> None:
        mine, theirs = pt(0, TEXT_DIM, "u1", "c1"), pt(0, TEXT_DIM, "u2", "c9")
        await store.upsert_text([mine, theirs])
        assert [h.id for h in await store.search_text(axis(0, TEXT_DIM), "u1")] == [mine.id]

    async def test_search_respects_limit(self, store: VectorStore) -> None:
        await store.upsert_text([pt(i, TEXT_DIM, "u1", f"c{i}") for i in range(4)])
        assert len(await store.search_text(axis(0, TEXT_DIM), "u1", limit=2)) == 2

    async def test_upsert_same_id_replaces(self, store: VectorStore) -> None:
        p = pt(0, TEXT_DIM, "u1", "c1", text="old")
        await store.upsert_text([p])
        await store.upsert_text([VectorPoint(p.id, p.vector, payload("u1", "c1", text="new"))])
        hits = await store.search_text(axis(0, TEXT_DIM), "u1")
        assert len(hits) == 1
        assert hits[0].payload["text"] == "new"

    async def test_empty_upsert_is_a_noop(self, store: VectorStore) -> None:
        await store.upsert_text([])
        await store.upsert_images([])

    async def test_text_and_image_collections_are_separate(self, store: VectorStore) -> None:
        t, i = pt(0, TEXT_DIM, "u1", "c1"), pt(0, IMAGE_DIM, "u1", "c1", modality="image")
        await store.upsert_text([t])
        await store.upsert_images([i])
        assert [h.id for h in await store.search_text(axis(0, TEXT_DIM), "u1")] == [t.id]
        assert [h.id for h in await store.search_images(axis(0, IMAGE_DIM), "u1")] == [i.id]

    async def test_delete_content_hits_both_collections_for_that_content_only(
        self, store: VectorStore
    ) -> None:
        await store.upsert_text([pt(0, TEXT_DIM, "u1", "c1"), pt(1, TEXT_DIM, "u1", "c2")])
        await store.upsert_images([pt(0, IMAGE_DIM, "u1", "c1"), pt(1, IMAGE_DIM, "u2", "c1")])
        await store.delete_content("u1", "c1")
        texts = await store.search_text(axis(0, TEXT_DIM), "u1", limit=10)
        assert [h.payload["contentId"] for h in texts] == ["c2"]
        assert await store.search_images(axis(0, IMAGE_DIM), "u1") == []
        assert len(await store.search_images(axis(1, IMAGE_DIM), "u2")) == 1

    async def test_delete_user_removes_everything_for_that_user(self, store: VectorStore) -> None:
        await store.upsert_text([pt(0, TEXT_DIM, "u1", "c1"), pt(1, TEXT_DIM, "u2", "c1")])
        await store.upsert_images([pt(0, IMAGE_DIM, "u1", "c1")])
        await store.delete_user("u1")
        assert await store.search_text(axis(0, TEXT_DIM), "u1") == []
        assert await store.search_images(axis(0, IMAGE_DIM), "u1") == []
        assert len(await store.search_text(axis(1, TEXT_DIM), "u2")) == 1

    async def test_scroll_filters_by_user_and_modality(self, store: VectorStore) -> None:
        await store.upsert_text(
            [
                pt(0, TEXT_DIM, "u1", "c1", modality="text"),
                pt(1, TEXT_DIM, "u1", "c2", modality="image"),
                pt(2, TEXT_DIM, "u2", "c3", modality="image"),
            ]
        )
        everything = await store.scroll(store.text_collection, "u1")
        assert sorted(p.payload["contentId"] for p in everything) == ["c1", "c2"]
        images = await store.scroll(store.text_collection, "u1", modality="image")
        assert [p.payload["contentId"] for p in images] == ["c2"]

    async def test_scroll_respects_limit(self, store: VectorStore) -> None:
        await store.upsert_text([pt(i, TEXT_DIM, "u1", f"c{i}") for i in range(3)])
        assert len(await store.scroll(store.text_collection, "u1", limit=2)) == 2

    async def test_reset_collections_empties_both(self, store: VectorStore) -> None:
        await store.upsert_text([pt(0, TEXT_DIM, "u1", "c1")])
        await store.upsert_images([pt(0, IMAGE_DIM, "u1", "c1")])
        await store.reset_collections()
        assert await store.search_text(axis(0, TEXT_DIM), "u1") == []
        assert await store.search_images(axis(0, IMAGE_DIM), "u1") == []
        await store.upsert_text([pt(0, TEXT_DIM, "u1", "c1")])
        assert len(await store.search_text(axis(0, TEXT_DIM), "u1")) == 1
