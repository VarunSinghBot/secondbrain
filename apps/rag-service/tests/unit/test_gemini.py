import json
import math

import httpx
import pytest

from app.clients.gemini import GeminiEmbedder
from app.clients.protocols import Embedder
from app.errors import ConfigError

URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001"


def embedder(handler: httpx.MockTransport, api_key: str = "k") -> GeminiEmbedder:
    return GeminiEmbedder(
        httpx.AsyncClient(transport=handler), api_key, "gemini-embedding-001", 768
    )


def test_conforms_to_protocol() -> None:
    _: Embedder = embedder(httpx.MockTransport(lambda r: httpx.Response(500)))


async def test_embed_text_request_shape_and_normalisation() -> None:
    seen: list[httpx.Request] = []

    def handle(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json={"embedding": {"values": [3.0, 4.0]}})

    vec = await embedder(httpx.MockTransport(handle)).embed_text("hello", "RETRIEVAL_QUERY")

    assert vec == pytest.approx([0.6, 0.8])
    req = seen[0]
    assert str(req.url) == f"{URL}:embedContent"
    assert req.headers["x-goog-api-key"] == "k"
    assert json.loads(req.content) == {
        "taskType": "RETRIEVAL_QUERY",
        "content": {"parts": [{"text": "hello"}]},
        "outputDimensionality": 768,
    }


async def test_zero_vector_is_returned_unscaled() -> None:
    t = httpx.MockTransport(
        lambda r: httpx.Response(200, json={"embedding": {"values": [0.0, 0.0]}})
    )
    assert await embedder(t).embed_text("x", "RETRIEVAL_DOCUMENT") == [0.0, 0.0]


async def test_embed_text_http_error_message() -> None:
    t = httpx.MockTransport(lambda r: httpx.Response(429, text="slow down"))
    with pytest.raises(
        RuntimeError, match=r"Gemini embedContent failed \(429 Too Many Requests\): slow down"
    ):
        await embedder(t).embed_text("x", "RETRIEVAL_DOCUMENT")


@pytest.mark.parametrize("body", [{}, {"embedding": {}}, {"embedding": {"values": []}}])
async def test_embed_text_missing_values(body: dict[str, object]) -> None:
    t = httpx.MockTransport(lambda r: httpx.Response(200, json=body))
    with pytest.raises(RuntimeError, match="missing embedding values"):
        await embedder(t).embed_text("x", "RETRIEVAL_DOCUMENT")


async def test_missing_api_key_fails_at_call_time_without_a_request() -> None:
    def handle(req: httpx.Request) -> httpx.Response:
        raise AssertionError("no request expected")

    with pytest.raises(ConfigError, match="GEMINI_API_KEY is not configured"):
        await embedder(httpx.MockTransport(handle), api_key="").embed_text("x", "RETRIEVAL_QUERY")


async def test_batch_sends_one_request_per_100_texts_and_keeps_order() -> None:
    seen: list[httpx.Request] = []

    def handle(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        reqs = json.loads(req.content)["requests"]
        # Encode each text's number into the vector so order is checkable.
        values = [{"values": [float(r["content"]["parts"][0]["text"]), 1.0]} for r in reqs]
        return httpx.Response(200, json={"embeddings": values})

    texts = [str(i) for i in range(250)]
    out = await embedder(httpx.MockTransport(handle)).embed_batch(texts, "RETRIEVAL_DOCUMENT")

    assert [len(json.loads(r.content)["requests"]) for r in seen] == [100, 100, 50]
    assert all(str(r.url) == f"{URL}:batchEmbedContents" for r in seen)
    assert len(out) == 250
    for i, v in enumerate(out):
        assert v == pytest.approx([i / math.hypot(i, 1.0), 1.0 / math.hypot(i, 1.0)])


async def test_batch_item_shape_matches_single_call() -> None:
    seen: list[httpx.Request] = []

    def handle(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json={"embeddings": [{"values": [1.0]}]})

    await embedder(httpx.MockTransport(handle)).embed_batch(["a"], "RETRIEVAL_DOCUMENT")
    assert json.loads(seen[0].content)["requests"] == [
        {
            "model": "models/gemini-embedding-001",
            "taskType": "RETRIEVAL_DOCUMENT",
            "content": {"parts": [{"text": "a"}]},
            "outputDimensionality": 768,
        }
    ]


async def test_batch_of_nothing_makes_no_request() -> None:
    def handle(req: httpx.Request) -> httpx.Response:
        raise AssertionError("no request expected")

    assert await embedder(httpx.MockTransport(handle)).embed_batch([], "RETRIEVAL_DOCUMENT") == []


async def test_batch_response_count_mismatch_is_an_error() -> None:
    t = httpx.MockTransport(lambda r: httpx.Response(200, json={"embeddings": [{"values": [1.0]}]}))
    with pytest.raises(RuntimeError, match="returned 1 embeddings for 2 texts"):
        await embedder(t).embed_batch(["a", "b"], "RETRIEVAL_DOCUMENT")


async def test_batch_http_error_message() -> None:
    t = httpx.MockTransport(lambda r: httpx.Response(400, text="bad"))
    with pytest.raises(
        RuntimeError, match=r"Gemini batchEmbedContents failed \(400 Bad Request\): bad"
    ):
        await embedder(t).embed_batch(["a"], "RETRIEVAL_DOCUMENT")
