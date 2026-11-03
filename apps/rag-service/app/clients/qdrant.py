import asyncio
import contextlib
import logging
from collections.abc import Sequence

from qdrant_client import AsyncQdrantClient
from qdrant_client.http.exceptions import UnexpectedResponse
from qdrant_client.http.models import (
    Distance,
    FieldCondition,
    Filter,
    FilterSelector,
    MatchValue,
    PayloadSchemaType,
    PointStruct,
    VectorParams,
)

from app.clients.protocols import SearchHit, StoredPoint, VectorPoint

log = logging.getLogger(__name__)

CLIP_VECTOR_SIZE = 512
_INDEXED_FIELDS = ("userId", "contentId")


def _match(**fields: str) -> Filter:
    return Filter(
        must=[FieldCondition(key=k, match=MatchValue(value=v)) for k, v in fields.items()]
    )


class QdrantVectorStore:
    """rag_text (Gemini, 768-d) and rag_images (CLIP, 512-d), cosine distance.

    Uses only client calls that exist on server v1.7.4 (search, not query_points,
    and no collection_exists), because that is what holds the existing data.
    """

    def __init__(
        self,
        client: AsyncQdrantClient,
        text_collection: str,
        image_collection: str,
        text_vector_size: int,
    ) -> None:
        self._client = client
        self._text = text_collection
        self._images = image_collection
        self._text_size = text_vector_size
        self._ready = False
        self._lock = asyncio.Lock()

    @property
    def text_collection(self) -> str:
        return self._text

    @property
    def image_collection(self) -> str:
        return self._images

    async def _get_size(self, name: str) -> int | None:
        try:
            info = await self._client.get_collection(name)
        except UnexpectedResponse as err:
            if err.status_code == 404:
                return None
            raise
        except ValueError:  # local/in-memory mode raises this for a missing collection
            return None
        vectors = info.config.params.vectors
        return vectors.size if isinstance(vectors, VectorParams) else 0

    async def _ensure_payload_indexes(self, name: str) -> None:
        for field in _INDEXED_FIELDS:
            with contextlib.suppress(Exception):
                await self._client.create_payload_index(
                    name, field, field_schema=PayloadSchemaType.KEYWORD, wait=True
                )

    async def _ensure_collection(self, name: str, size: int) -> None:
        existing = await self._get_size(name)
        if existing is not None and existing == size:
            await self._ensure_payload_indexes(name)
            return
        if existing is not None:
            log.warning(
                "Recreating collection '%s' due to size mismatch (existing: %d, expected: %d)",
                name,
                existing,
                size,
            )
            await self._client.delete_collection(name)
        await self._client.create_collection(
            name, vectors_config=VectorParams(size=size, distance=Distance.COSINE)
        )
        await self._ensure_payload_indexes(name)

    async def ensure_collections(self) -> None:
        async with self._lock:
            if self._ready:
                return
            await asyncio.gather(
                self._ensure_collection(self._text, self._text_size),
                self._ensure_collection(self._images, CLIP_VECTOR_SIZE),
            )
            self._ready = True

    async def _upsert(self, collection: str, points: Sequence[VectorPoint]) -> None:
        if not points:
            return
        await self.ensure_collections()
        await self._client.upsert(
            collection,
            points=[PointStruct(id=p.id, vector=p.vector, payload=p.payload) for p in points],
            wait=True,
        )

    async def upsert_text(self, points: Sequence[VectorPoint]) -> None:
        await self._upsert(self._text, points)

    async def upsert_images(self, points: Sequence[VectorPoint]) -> None:
        await self._upsert(self._images, points)

    async def _search(
        self, collection: str, vector: Sequence[float], user_id: str, limit: int
    ) -> list[SearchHit]:
        await self.ensure_collections()
        hits = await self._client.search(
            collection,
            query_vector=list(vector),
            limit=limit,
            with_payload=True,
            query_filter=_match(userId=user_id),
        )
        return [SearchHit(str(h.id), h.score, dict(h.payload or {})) for h in hits]

    async def search_text(
        self, vector: Sequence[float], user_id: str, limit: int = 5
    ) -> list[SearchHit]:
        return await self._search(self._text, vector, user_id, limit)

    async def search_images(
        self, vector: Sequence[float], user_id: str, limit: int = 5
    ) -> list[SearchHit]:
        return await self._search(self._images, vector, user_id, limit)

    async def _delete(self, filt: Filter) -> None:
        await self.ensure_collections()
        await asyncio.gather(
            *(
                self._client.delete(c, points_selector=FilterSelector(filter=filt), wait=True)
                for c in (self._text, self._images)
            )
        )

    async def delete_content(self, user_id: str, content_id: str) -> None:
        await self._delete(_match(userId=user_id, contentId=content_id))

    async def delete_user(self, user_id: str) -> None:
        await self._delete(_match(userId=user_id))

    async def scroll(
        self, collection: str, user_id: str, modality: str | None = None, limit: int = 100
    ) -> list[StoredPoint]:
        await self.ensure_collections()
        fields = {"userId": user_id, **({"modality": modality} if modality else {})}
        records, _next = await self._client.scroll(
            collection,
            scroll_filter=_match(**fields),
            limit=limit,
            with_payload=True,
            with_vectors=False,
        )
        return [StoredPoint(str(r.id), dict(r.payload or {})) for r in records]

    async def reset_collections(self) -> None:
        """Delete and recreate both collections. Callers must re-ingest everything."""
        async with self._lock:
            self._ready = False
        for name in (self._text, self._images):
            try:
                await self._client.delete_collection(name)
            except Exception as err:  # a missing collection is fine (as in the TS)
                log.warning("Failed to delete collection %s: %s", name, err)
        await self.ensure_collections()
