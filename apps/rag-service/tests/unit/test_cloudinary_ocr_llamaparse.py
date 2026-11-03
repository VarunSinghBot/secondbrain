import hashlib
import json

import httpx
import pytest

from app.clients.cloudinary import CloudinaryStore
from app.clients.llamaparse import LlamaParseClient
from app.clients.ocr import OcrSpaceClient
from app.clients.protocols import DocumentParser, MediaStore, OcrEngine
from app.errors import ConfigError

# ── Cloudinary ─────────────────────────────────────────────────────────────


def cloudinary(handler: httpx.MockTransport, secret: str = "shh") -> CloudinaryStore:
    return CloudinaryStore(
        httpx.AsyncClient(transport=handler), "demo", "key123", secret, now=lambda: 1_700_000_000.9
    )


async def test_cloudinary_signed_upload() -> None:
    seen: list[httpx.Request] = []

    def handle(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(
            200,
            json={
                "secure_url": "https://res.cloudinary.com/demo/image/upload/x.png",
                "public_id": "multimodal_rag/x",
                "format": "png",
                "resource_type": "image",
            },
        )

    _: MediaStore = cloudinary(httpx.MockTransport(handle))
    result = await cloudinary(httpx.MockTransport(handle)).upload(b"PNG", "x.png", "image")

    assert result.url == "https://res.cloudinary.com/demo/image/upload/x.png"
    assert (result.public_id, result.format, result.resource_type) == (
        "multimodal_rag/x",
        "png",
        "image",
    )
    req = seen[0]
    assert str(req.url) == "https://api.cloudinary.com/v1_1/demo/image/upload"
    expected_sig = hashlib.sha1(b"folder=multimodal_rag&timestamp=1700000000shh").hexdigest()
    body = req.content
    assert f'name="signature"\r\n\r\n{expected_sig}'.encode() in body
    assert b'name="timestamp"\r\n\r\n1700000000' in body
    assert b'name="api_key"\r\n\r\nkey123' in body
    assert b'name="folder"\r\n\r\nmultimodal_rag' in body
    assert b'name="file"; filename="x.png"' in body
    assert b"shh" not in body


async def test_cloudinary_defaults_to_auto_resource_type() -> None:
    seen: list[httpx.Request] = []

    def handle(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(
            200, json={"secure_url": "u", "public_id": "p", "resource_type": "raw"}
        )

    result = await cloudinary(httpx.MockTransport(handle)).upload(b"x", "a.pdf")
    assert seen[0].url.path == "/v1_1/demo/auto/upload"
    assert result.format is None


async def test_cloudinary_error_and_missing_config() -> None:
    t = httpx.MockTransport(lambda r: httpx.Response(401, text="bad sig"))
    with pytest.raises(RuntimeError, match=r"Cloudinary upload failed \(401\): bad sig"):
        await cloudinary(t).upload(b"x", "a.png")
    with pytest.raises(ConfigError, match="CLOUDINARY_API_SECRET"):
        await cloudinary(t, secret="").upload(b"x", "a.png")


# ── OCR.space ──────────────────────────────────────────────────────────────


def ocr(handler: httpx.MockTransport, api_key: str = "ok") -> OcrSpaceClient:
    return OcrSpaceClient(httpx.AsyncClient(transport=handler), api_key)


async def test_ocr_request_and_trimmed_text() -> None:
    seen: list[httpx.Request] = []

    def handle(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json={"ParsedResults": [{"ParsedText": "  Hello\r\n "}]})

    _: OcrEngine = ocr(httpx.MockTransport(handle))
    assert await ocr(httpx.MockTransport(handle)).extract_text(b"IMG", "scan.png") == "Hello"
    req = seen[0]
    assert str(req.url) == "https://api.ocr.space/parse/image"
    for field, value in [("apikey", "ok"), ("language", "eng"), ("isOverlayRequired", "false")]:
        assert f'name="{field}"\r\n\r\n{value}'.encode() in req.content
    assert b'name="file"; filename="scan.png"' in req.content


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"ErrorMessage": ["bad", "worse"]}, "bad, worse"),
        ({"ErrorMessage": "single"}, "single"),
        ({"ParsedResults": [{"ParsedText": "  "}]}, "OCR.Space response missing text"),
        ({}, "OCR.Space response missing text"),
    ],
)
async def test_ocr_no_text_errors(body: dict[str, object], message: str) -> None:
    t = httpx.MockTransport(lambda r: httpx.Response(200, json=body))
    with pytest.raises(RuntimeError, match=message):
        await ocr(t).extract_text(b"x")


async def test_ocr_http_error_and_missing_key() -> None:
    t = httpx.MockTransport(lambda r: httpx.Response(503))
    with pytest.raises(RuntimeError, match=r"OCR.Space request failed: 503 Service Unavailable"):
        await ocr(t).extract_text(b"x")
    with pytest.raises(ConfigError, match="OCR_SPACE_API_KEY"):
        await ocr(t, api_key="").extract_text(b"x")


# ── LlamaParse ─────────────────────────────────────────────────────────────


class LlamaHarness:
    def __init__(self, *polls: dict[str, object], create: dict[str, object] | None = None) -> None:
        self.polls = list(polls)
        self.create = create if create is not None else {"id": "job-1"}
        self.requests: list[httpx.Request] = []
        self.sleeps: list[float] = []
        self.client = LlamaParseClient(
            httpx.AsyncClient(transport=httpx.MockTransport(self.handle)),
            "lk",
            sleep=self.sleep,
        )

    def handle(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        if req.method == "POST":
            return httpx.Response(200, json=self.create)
        return httpx.Response(200, json=self.polls.pop(0))

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)


def done(**extra: object) -> dict[str, object]:
    return {"job": {"status": "COMPLETED"}, **extra}


async def test_llamaparse_create_then_poll() -> None:
    h = LlamaHarness({"job": {"status": "PENDING"}}, done(markdown_full="# Doc"))
    _: DocumentParser = h.client
    assert await h.client.parse_from_url("https://x/y.pdf") == "# Doc"

    create, first_poll, _second = h.requests
    assert str(create.url) == "https://api.cloud.llamaindex.ai/api/v2/parse"
    assert create.headers["authorization"] == "Bearer lk"
    assert json.loads(create.content) == {
        "source_url": "https://x/y.pdf",
        "tier": "cost_effective",
        "version": "latest",
    }
    assert (
        str(first_poll.url)
        == "https://api.cloud.llamaindex.ai/api/v2/parse/job-1?expand=markdown_full%2Ctext_full"
        or str(first_poll.url)
        == "https://api.cloud.llamaindex.ai/api/v2/parse/job-1?expand=markdown_full,text_full"
    )
    assert h.sleeps == [2.0]


async def test_llamaparse_job_id_can_be_nested() -> None:
    h = LlamaHarness(done(text_full="plain"), create={"job": {"id": "nested"}})
    assert await h.client.parse_from_url("u") == "plain"
    assert h.requests[1].url.path.endswith("/parse/nested")


@pytest.mark.parametrize(
    ("extra", "expected"),
    [
        ({"markdown_full": "md", "text_full": "tx"}, "md"),
        ({"text_full": "tx"}, "tx"),
        ({"markdown": {"pages": [{"markdown": "a"}, {"markdown": "b"}, {}]}}, "a\n\nb\n\n"),
        ({"text": {"pages": [{"text": "a"}, {"text": "b"}]}}, "a\n\nb"),
    ],
)
async def test_llamaparse_flattens_each_response_shape(
    extra: dict[str, object], expected: str
) -> None:
    assert await LlamaHarness(done(**extra)).client.parse_from_url("u") == expected


async def test_llamaparse_failures() -> None:
    with pytest.raises(RuntimeError, match="without text output"):
        await LlamaHarness(done()).client.parse_from_url("u")
    with pytest.raises(RuntimeError, match="unsupported file"):
        await LlamaHarness(
            {"job": {"status": "FAILED", "error_message": "unsupported file"}}
        ).client.parse_from_url("u")
    with pytest.raises(RuntimeError, match="job cancelled"):
        await LlamaHarness({"job": {"status": "CANCELLED"}}).client.parse_from_url("u")
    with pytest.raises(RuntimeError, match="missing job id"):
        await LlamaHarness(create={}).client.parse_from_url("u")
    with pytest.raises(ConfigError, match="LLAMA_CLOUD_API_KEY"):
        await LlamaParseClient(httpx.AsyncClient(), "").parse_from_url("u")


async def test_llamaparse_http_errors() -> None:
    t = httpx.MockTransport(lambda r: httpx.Response(422))
    c = LlamaParseClient(httpx.AsyncClient(transport=t), "lk")
    with pytest.raises(RuntimeError, match=r"job creation failed: 422"):
        await c.parse_from_url("u")


async def test_llamaparse_times_out_after_60_polls() -> None:
    pending: list[dict[str, object]] = [{"job": {"status": "PENDING"}}] * 60
    h = LlamaHarness(*pending)
    with pytest.raises(RuntimeError, match="timed out"):
        await h.client.parse_from_url("u")
    assert len(h.requests) == 61
    assert h.sleeps == [2.0] * 60
