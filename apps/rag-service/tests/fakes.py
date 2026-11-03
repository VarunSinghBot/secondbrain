"""In-memory fakes for every Protocol in app.clients.protocols."""

import hashlib
import math
import random
from collections.abc import Sequence
from typing import Any

from app.clients.protocols import (
    EmbeddingTaskType,
    ResourceType,
    SearchHit,
    StoredPoint,
    UploadResult,
    VectorPoint,
)


def _normalize(v: list[float]) -> list[float]:
    mag = math.sqrt(sum(x * x for x in v))
    return [x / mag for x in v] if mag > 0 else v


def pseudo_vector(text: str, dim: int) -> list[float]:
    """Deterministic unit vector per text; different texts are near-orthogonal."""
    rng = random.Random(hashlib.sha256(text.encode()).digest())
    return _normalize([rng.uniform(-1, 1) for _ in range(dim)])


class FakeEmbedder:
    def __init__(self, dim: int = 768) -> None:
        self.dim = dim
        self.calls: list[tuple[str, list[str], EmbeddingTaskType]] = []

    async def embed_text(self, text: str, task_type: EmbeddingTaskType) -> list[float]:
        self.calls.append(("embed_text", [text], task_type))
        return pseudo_vector(text, self.dim)

    async def embed_batch(
        self, texts: Sequence[str], task_type: EmbeddingTaskType
    ) -> list[list[float]]:
        self.calls.append(("embed_batch", list(texts), task_type))
        return [pseudo_vector(t, self.dim) for t in texts]


class FakeVectorStore:
    def __init__(
        self,
        text_collection: str = "rag_text",
        image_collection: str = "rag_images",
    ) -> None:
        self._text_collection = text_collection
        self._image_collection = image_collection
        self.collections: dict[str, dict[str, VectorPoint]] = {}
        self.ensure_calls = 0

    @property
    def text_collection(self) -> str:
        return self._text_collection

    @property
    def image_collection(self) -> str:
        return self._image_collection

    async def ensure_collections(self) -> None:
        self.ensure_calls += 1
        self.collections.setdefault(self._text_collection, {})
        self.collections.setdefault(self._image_collection, {})

    async def upsert_text(self, points: Sequence[VectorPoint]) -> None:
        await self._upsert(self._text_collection, points)

    async def upsert_images(self, points: Sequence[VectorPoint]) -> None:
        await self._upsert(self._image_collection, points)

    async def _upsert(self, collection: str, points: Sequence[VectorPoint]) -> None:
        await self.ensure_collections()
        for p in points:
            self.collections[collection][p.id] = p

    async def search_text(
        self, vector: Sequence[float], user_id: str, limit: int = 5
    ) -> list[SearchHit]:
        return await self._search(self._text_collection, vector, user_id, limit)

    async def search_images(
        self, vector: Sequence[float], user_id: str, limit: int = 5
    ) -> list[SearchHit]:
        return await self._search(self._image_collection, vector, user_id, limit)

    async def _search(
        self, collection: str, vector: Sequence[float], user_id: str, limit: int
    ) -> list[SearchHit]:
        await self.ensure_collections()
        q = _normalize(list(vector))
        hits = [
            SearchHit(
                p.id, sum(a * b for a, b in zip(q, _normalize(p.vector), strict=True)), p.payload
            )
            for p in self.collections[collection].values()
            if p.payload.get("userId") == user_id
        ]
        return sorted(hits, key=lambda h: -h.score)[:limit]

    async def delete_content(self, user_id: str, content_id: str) -> None:
        await self.ensure_collections()
        for points in self.collections.values():
            for pid in [
                p.id
                for p in points.values()
                if p.payload.get("userId") == user_id and p.payload.get("contentId") == content_id
            ]:
                del points[pid]

    async def delete_user(self, user_id: str) -> None:
        await self.ensure_collections()
        for points in self.collections.values():
            for pid in [p.id for p in points.values() if p.payload.get("userId") == user_id]:
                del points[pid]

    async def scroll(
        self, collection: str, user_id: str, modality: str | None = None, limit: int = 100
    ) -> list[StoredPoint]:
        await self.ensure_collections()
        found = [
            StoredPoint(p.id, p.payload)
            for p in self.collections[collection].values()
            if p.payload.get("userId") == user_id
            and (modality is None or p.payload.get("modality") == modality)
        ]
        return found[:limit]

    async def reset_collections(self) -> None:
        self.collections = {}
        await self.ensure_collections()


class FakeLLM:
    def __init__(
        self,
        answer: str = "fake answer",
        caption: str = "a fake caption",
        rewrite: str | None = None,
    ) -> None:
        self.answer = answer
        self.caption = caption
        self.rewrite = rewrite
        self.answer_calls: list[tuple[str, str | None]] = []
        self.caption_calls: list[tuple[bytes, str]] = []

    async def generate_answer(self, system_prompt: str, user_prompt: str | None = None) -> str:
        self.answer_calls.append((system_prompt, user_prompt))
        return self.answer

    async def caption_image(self, image: bytes, mime_type: str = "image/jpeg") -> str:
        self.caption_calls.append((image, mime_type))
        return self.caption

    async def rewrite_query(self, query: str) -> str:
        return self.rewrite if self.rewrite is not None else query


class FakeTranscriber:
    def __init__(self, text: str = "fake transcript") -> None:
        self.text = text
        self.calls: list[tuple[bytes, str]] = []

    async def transcribe(self, audio: bytes, file_name: str = "audio.mp3") -> str:
        self.calls.append((audio, file_name))
        return self.text


class FakeDocumentParser:
    def __init__(self, text: str = "# fake parsed document") -> None:
        self.text = text
        self.urls: list[str] = []

    async def parse_from_url(self, source_url: str) -> str:
        self.urls.append(source_url)
        return self.text


class FakeOcr:
    def __init__(self, text: str = "fake ocr text") -> None:
        self.text = text
        self.calls: list[tuple[bytes, str]] = []

    async def extract_text(self, image: bytes, file_name: str = "image.png") -> str:
        self.calls.append((image, file_name))
        return self.text


class FakeImageTagger:
    def __init__(self, tags: Sequence[str] = ("nature", "sky"), dim: int = 512) -> None:
        self.tags = list(tags)
        self.dim = dim

    async def embed_image(self, image: bytes) -> list[float]:
        return pseudo_vector(image.hex(), self.dim)

    async def embed_text(self, text: str) -> list[float]:
        return pseudo_vector(text, self.dim)

    async def tag_image(self, image: bytes) -> list[str]:
        return list(self.tags)


class FakeMediaStore:
    def __init__(self) -> None:
        self.uploads: list[tuple[bytes, str, ResourceType]] = []

    async def upload(
        self, file: bytes, file_name: str, resource_type: ResourceType = "auto"
    ) -> UploadResult:
        self.uploads.append((file, file_name, resource_type))
        public_id = f"multimodal_rag/{file_name}"
        return UploadResult(
            url=f"https://fake.cloudinary.test/{public_id}",
            public_id=public_id,
            format=file_name.rsplit(".", 1)[-1] if "." in file_name else None,
            resource_type="image" if resource_type == "auto" else resource_type,
        )


def payload(user_id: str, content_id: str, **extra: Any) -> dict[str, Any]:
    return {"userId": user_id, "contentId": content_id, **extra}
