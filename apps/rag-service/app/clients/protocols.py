"""Every external service the app talks to, as a Protocol.

Services depend on these, never on the concrete clients, so the unit suite can
inject fakes (tests/fakes.py) and run with no keys and no network.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

# RETRIEVAL_DOCUMENT for content being indexed, RETRIEVAL_QUERY for the user's question.
# Gemini embeds each differently; swapping them silently degrades retrieval.
EmbeddingTaskType = Literal["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"]
ResourceType = Literal["image", "video", "raw", "auto"]


@dataclass(frozen=True)
class VectorPoint:
    id: str
    vector: list[float]
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SearchHit:
    id: str
    score: float
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class StoredPoint:
    id: str
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class UploadResult:
    url: str
    public_id: str
    format: str | None
    resource_type: str


class Embedder(Protocol):
    async def embed_text(self, text: str, task_type: EmbeddingTaskType) -> list[float]: ...

    async def embed_batch(
        self, texts: Sequence[str], task_type: EmbeddingTaskType
    ) -> list[list[float]]: ...


class VectorStore(Protocol):
    @property
    def text_collection(self) -> str: ...

    @property
    def image_collection(self) -> str: ...

    async def ensure_collections(self) -> None: ...

    async def upsert_text(self, points: Sequence[VectorPoint]) -> None: ...

    async def upsert_images(self, points: Sequence[VectorPoint]) -> None: ...

    async def search_text(
        self, vector: Sequence[float], user_id: str, limit: int = 5
    ) -> list[SearchHit]: ...

    async def search_images(
        self, vector: Sequence[float], user_id: str, limit: int = 5
    ) -> list[SearchHit]: ...

    async def delete_content(self, user_id: str, content_id: str) -> None: ...

    async def delete_user(self, user_id: str) -> None: ...

    async def scroll(
        self, collection: str, user_id: str, modality: str | None = None, limit: int = 100
    ) -> list[StoredPoint]: ...

    async def reset_collections(self) -> None: ...


class LLM(Protocol):
    async def generate_answer(self, system_prompt: str, user_prompt: str | None = None) -> str: ...

    async def caption_image(self, image: bytes, mime_type: str = "image/jpeg") -> str: ...

    async def rewrite_query(self, query: str) -> str:
        """Never raises: any failure returns the original query."""
        ...


class Transcriber(Protocol):
    async def transcribe(self, audio: bytes, file_name: str = "audio.mp3") -> str: ...


class DocumentParser(Protocol):
    async def parse_from_url(self, source_url: str) -> str: ...


class OcrEngine(Protocol):
    async def extract_text(self, image: bytes, file_name: str = "image.png") -> str: ...


class ImageTagger(Protocol):
    """The CLIP surface: image/text embeddings in one space, plus zero-shot tags."""

    async def embed_image(self, image: bytes) -> list[float]: ...

    async def embed_text(self, text: str) -> list[float]: ...

    async def tag_image(self, image: bytes) -> list[str]: ...


class MediaStore(Protocol):
    async def upload(
        self, file: bytes, file_name: str, resource_type: ResourceType = "auto"
    ) -> UploadResult: ...
