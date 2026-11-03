import math
from collections.abc import Sequence
from typing import Any

import httpx

from app.clients.protocols import EmbeddingTaskType
from app.errors import require

_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_MAX_BATCH = 100  # batchEmbedContents accepts at most 100 requests per call


def _normalize(values: list[float]) -> list[float]:
    # gemini-embedding-001 only auto-normalizes the full 3072-dim output; a
    # truncated outputDimensionality (768) has to be renormalized by hand.
    magnitude = math.sqrt(sum(v * v for v in values))
    return [v / magnitude for v in values] if magnitude > 0 else values


def _values(embedding: Any, context: Any) -> list[float]:
    values = embedding.get("values") if isinstance(embedding, dict) else None
    if not isinstance(values, list) or not values:
        raise RuntimeError(f"Gemini embedContent response missing embedding values: {context}")
    return _normalize([float(v) for v in values])


class GeminiEmbedder:
    def __init__(self, http: httpx.AsyncClient, api_key: str, model: str, dimensions: int) -> None:
        self._http = http
        self._api_key = api_key
        self._model = model
        self._dimensions = dimensions

    def _request(self, text: str, task_type: EmbeddingTaskType) -> dict[str, Any]:
        return {
            "taskType": task_type,
            "content": {"parts": [{"text": text}]},
            "outputDimensionality": self._dimensions,
        }

    async def _post(self, method: str, body: dict[str, Any]) -> Any:
        key = require(self._api_key, "GEMINI_API_KEY")
        response = await self._http.post(
            f"{_BASE}/{self._model}:{method}", json=body, headers={"x-goog-api-key": key}
        )
        if response.is_error:
            raise RuntimeError(
                f"Gemini {method} failed ({response.status_code} {response.reason_phrase}): "
                f"{response.text}"
            )
        return response.json()

    async def embed_text(self, text: str, task_type: EmbeddingTaskType) -> list[float]:
        data = await self._post("embedContent", self._request(text, task_type))
        return _values(data.get("embedding"), data)

    async def embed_batch(
        self, texts: Sequence[str], task_type: EmbeddingTaskType
    ) -> list[list[float]]:
        out: list[list[float]] = []
        for start in range(0, len(texts), _MAX_BATCH):
            batch = texts[start : start + _MAX_BATCH]
            requests = [
                {"model": f"models/{self._model}", **self._request(t, task_type)} for t in batch
            ]
            data = await self._post("batchEmbedContents", {"requests": requests})
            embeddings = data.get("embeddings") or []
            if len(embeddings) != len(batch):
                raise RuntimeError(
                    f"Gemini batchEmbedContents returned {len(embeddings)} embeddings "
                    f"for {len(batch)} texts"
                )
            out.extend(_values(e, data) for e in embeddings)
        return out
