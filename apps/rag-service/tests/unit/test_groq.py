import json

import httpx
import pytest

from app.clients.groq import GroqClient
from app.clients.protocols import LLM, Transcriber
from app.errors import ConfigError

CHAT = "https://api.groq.com/openai/v1/chat/completions"
ASR = "https://api.groq.com/openai/v1/audio/transcriptions"


def chat_ok(content: str | None) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


class Harness:
    def __init__(self, *responses: httpx.Response | Exception, api_key: str = "gk") -> None:
        self.queue = list(responses)
        self.requests: list[httpx.Request] = []
        self.sleeps: list[float] = []
        self.client = GroqClient(
            httpx.AsyncClient(transport=httpx.MockTransport(self.handle)),
            api_key,
            llm_model="llm-m",
            asr_model="asr-m",
            caption_model="cap-m",
            query_rewrite_model="rw-m",
            sleep=self.sleep,
        )

    def handle(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        nxt = self.queue.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)

    def body(self, i: int = 0) -> dict[str, object]:
        body: dict[str, object] = json.loads(self.requests[i].content)
        return body


def test_conforms_to_protocols() -> None:
    h = Harness()
    _llm: LLM = h.client
    _asr: Transcriber = h.client


# ── generate_answer ────────────────────────────────────────────────────────


async def test_generate_answer_with_system_and_user() -> None:
    h = Harness(chat_ok("hi"))
    assert await h.client.generate_answer("sys", "user q") == "hi"
    assert h.requests[0].url == CHAT
    assert h.requests[0].headers["authorization"] == "Bearer gk"
    assert h.body() == {
        "model": "llm-m",
        "messages": [{"role": "system", "content": "sys"}, {"role": "user", "content": "user q"}],
        "temperature": 0.2,
        "max_tokens": 1024,
    }


async def test_generate_answer_single_prompt_is_a_user_message() -> None:
    h = Harness(chat_ok("hi"))
    await h.client.generate_answer("only")
    assert h.body()["messages"] == [{"role": "user", "content": "only"}]


async def test_generate_answer_errors() -> None:
    with pytest.raises(RuntimeError, match=r"Groq chat completion failed \(500\): boom"):
        await Harness(httpx.Response(500, text="boom")).client.generate_answer("x")
    with pytest.raises(RuntimeError, match="empty content"):
        await Harness(chat_ok(None)).client.generate_answer("x")
    with pytest.raises(ConfigError, match="GROQ_API_KEY"):
        await Harness(api_key="").client.generate_answer("x")


# ── caption_image ──────────────────────────────────────────────────────────


async def test_caption_request_shape_and_trim() -> None:
    h = Harness(chat_ok("  a cat on a sofa \n"))
    assert await h.client.caption_image(b"\x01\x02", "image/png") == "a cat on a sofa"
    body = h.body()
    assert body["model"] == "cap-m"
    assert body["reasoning_effort"] == "none"
    assert body["max_tokens"] == 200
    content = body["messages"][0]["content"]  # type: ignore[index]
    assert content[0]["type"] == "text"
    assert content[1] == {"type": "image_url", "image_url": {"url": "data:image/png;base64,AQI="}}


async def test_caption_retries_429_then_succeeds_with_exponential_backoff() -> None:
    h = Harness(httpx.Response(429), httpx.Response(429), chat_ok("ok"))
    assert await h.client.caption_image(b"x") == "ok"
    assert len(h.requests) == 3
    # base 1s then 2s, plus up to 250ms jitter
    assert 1.0 <= h.sleeps[0] < 1.25
    assert 2.0 <= h.sleeps[1] < 2.25


async def test_caption_honours_retry_after_header_and_body_hint() -> None:
    h = Harness(
        httpx.Response(429, headers={"retry-after": "5"}),
        httpx.Response(429, text="Rate limit. Please try again in 14.69s."),
        chat_ok("ok"),
    )
    await h.client.caption_image(b"x")
    assert 5.0 <= h.sleeps[0] < 5.25
    assert 14.69 <= h.sleeps[1] < 14.94


async def test_caption_backoff_doubles_to_4s_on_the_last_retry() -> None:
    h = Harness(*[httpx.Response(429)] * 4)
    with pytest.raises(RuntimeError):
        await h.client.caption_image(b"x")
    assert 4.0 <= h.sleeps[2] < 4.25


async def test_caption_gives_up_after_3_retries() -> None:
    h = Harness(*[httpx.Response(429, text="limited")] * 4)
    with pytest.raises(RuntimeError, match=r"Groq image captioning failed \(429\): limited"):
        await h.client.caption_image(b"x")
    assert len(h.requests) == 4
    assert len(h.sleeps) == 3


async def test_caption_does_not_retry_other_errors() -> None:
    h = Harness(httpx.Response(400, text="bad image"))
    with pytest.raises(RuntimeError, match=r"failed \(400\): bad image"):
        await h.client.caption_image(b"x")
    assert h.sleeps == []


async def test_caption_empty_content_is_an_error() -> None:
    with pytest.raises(RuntimeError, match="empty content"):
        await Harness(chat_ok("   ")).client.caption_image(b"x")


# ── rewrite_query ──────────────────────────────────────────────────────────


async def test_rewrite_request_and_quote_stripping() -> None:
    h = Harness(chat_ok('  "did I do lab stuff?"  '))
    assert await h.client.rewrite_query("did i do lab stuf") == "did I do lab stuff?"
    body = h.body()
    assert body["model"] == "rw-m"
    assert body["temperature"] == 0.1
    assert body["max_tokens"] == 150
    assert body["reasoning_effort"] == "low"
    assert body["messages"][1] == {"role": "user", "content": "did i do lab stuf"}  # type: ignore[index]
    assert "You do NOT answer it." in body["messages"][0]["content"]  # type: ignore[index]


async def test_rewrite_strips_exactly_one_quote_from_each_end() -> None:
    h = Harness(chat_ok('""two"" quotes""'))
    assert await h.client.rewrite_query("q") == '"two"" quotes"'


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500),
        httpx.ConnectError("down"),
        httpx.ReadTimeout("slow"),
        chat_ok(""),
        chat_ok(None),
        httpx.Response(200, text="not json"),
    ],
)
async def test_rewrite_never_raises_and_falls_back_to_original(
    response: httpx.Response | Exception,
) -> None:
    assert await Harness(response).client.rewrite_query("original?") == "original?"


async def test_rewrite_without_api_key_makes_no_request() -> None:
    h = Harness(api_key="")
    assert await h.client.rewrite_query("q") == "q"
    assert h.requests == []


# ── transcribe ─────────────────────────────────────────────────────────────


async def test_transcribe_request_shape() -> None:
    h = Harness(httpx.Response(200, json={"text": "hello world"}))
    assert await h.client.transcribe(b"AUDIO", "clip.mp3") == "hello world"
    req = h.requests[0]
    assert req.url == ASR
    assert req.headers["authorization"] == "Bearer gk"
    assert req.headers["content-type"].startswith("multipart/form-data")
    assert b'name="model"\r\n\r\nasr-m' in req.content
    assert b'name="response_format"\r\n\r\njson' in req.content
    assert b'name="file"; filename="clip.mp3"' in req.content
    assert b"AUDIO" in req.content


async def test_transcribe_errors() -> None:
    with pytest.raises(
        RuntimeError, match=r"Groq transcription failed \(413 Request Entity Too Large\): big"
    ):
        await Harness(httpx.Response(413, text="big")).client.transcribe(b"x")
    with pytest.raises(RuntimeError, match="missing text"):
        await Harness(httpx.Response(200, json={})).client.transcribe(b"x")
