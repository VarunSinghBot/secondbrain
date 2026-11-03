import asyncio
import base64
import logging
import random
import re
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from app.errors import require

log = logging.getLogger(__name__)

_CHAT = "https://api.groq.com/openai/v1/chat/completions"
_ASR = "https://api.groq.com/openai/v1/audio/transcriptions"

_CAPTION_PROMPT = (
    "Describe this image in one or two concise sentences, focused on concrete visual content: "
    "objects, people, setting, and any visible text. Do not speculate beyond what's visible, "
    "and do not add commentary."
)

# qwen3.6-27b's rate limit is easy to cross partway through a video's frame batch,
# so a 429 is retried with backoff before the caller falls back to a generic caption.
_CAPTION_MAX_RETRIES = 3
_CAPTION_BACKOFF_BASE_MS = 1000
_CAPTION_BACKOFF_CAP_MS = 8000

# Deliberately conservative: an earlier version that "expanded vague pronouns" let the
# model invent specifics the user never stated, corrupting retrieval.
_REWRITE_SYSTEM_PROMPT = (
    "You rewrite a user's search query so it retrieves better from their personal notes. "
    "You do NOT answer it.\n\n"
    "Rules:\n"
    "- Fix spelling, grammar, and punctuation only.\n"
    "- Preserve the exact meaning and scope. Never add detail the user didn't state. "
    '"lab stuff" stays "lab stuff" — do not expand it to "laboratory experiment documentation" '
    "or invent specifics.\n"
    "- Keep the user's own words and phrasing wherever they're already valid. "
    'Keep first person ("did I", "my notes").\n'
    "- Do not add, remove, or reorder the intent. Do not make a vague query specific.\n"
    "- If the query is already well-formed, return it unchanged.\n"
    "- If the input is not a question or search query, return it exactly as given.\n"
    "- Output ONLY the rewritten query — no quotes, no backticks, no preamble, no explanation, "
    "no answer to the query. One line, plain text."
)
# On the critical path of every ask, so held to a tight total timeout.
_REWRITE_TIMEOUT_S = 3.0

_RETRY_HINT = re.compile(r"try again in ([\d.]+)s", re.IGNORECASE)
_EDGE_QUOTES = re.compile(r"^[\"']|[\"']$")


def _retry_delay_ms(response: httpx.Response, error_body: str) -> float | None:
    header = response.headers.get("retry-after")
    if header:
        try:
            seconds = float(header)
        except ValueError:
            pass
        else:
            if seconds >= 0:
                return seconds * 1000
    hint = _RETRY_HINT.search(error_body)
    if hint:
        try:
            return float(hint.group(1)) * 1000
        except ValueError:
            return None
    return None


def _first_content(data: Any) -> str | None:
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return None
    return content if isinstance(content, str) else None


class GroqClient:
    """Chat, vision captioning, query rewriting and Whisper, all on Groq."""

    def __init__(
        self,
        http: httpx.AsyncClient,
        api_key: str,
        *,
        llm_model: str,
        asr_model: str,
        caption_model: str,
        query_rewrite_model: str,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._http = http
        self._api_key = api_key
        self._llm_model = llm_model
        self._asr_model = asr_model
        self._caption_model = caption_model
        self._rewrite_model = query_rewrite_model
        self._sleep = sleep

    def _auth(self, key: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {key}"}

    async def generate_answer(self, system_prompt: str, user_prompt: str | None = None) -> str:
        key = require(self._api_key, "GROQ_API_KEY")
        messages = (
            [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
            if user_prompt
            else [{"role": "user", "content": system_prompt}]
        )
        response = await self._http.post(
            _CHAT,
            headers=self._auth(key),
            json={
                "model": self._llm_model or "openai/gpt-oss-120b",
                "messages": messages,
                "temperature": 0.2,
                "max_tokens": 1024,
            },
        )
        if response.is_error:
            raise RuntimeError(
                f"Groq chat completion failed ({response.status_code}): {response.text}"
            )
        content = _first_content(response.json())
        if not content:
            raise RuntimeError("Groq LLM response returned empty content")
        return content

    async def caption_image(self, image: bytes, mime_type: str = "image/jpeg") -> str:
        key = require(self._api_key, "GROQ_API_KEY")
        body = {
            "model": self._caption_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": _CAPTION_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{base64.b64encode(image).decode()}"
                            },
                        },
                    ],
                }
            ],
            # qwen3.6-27b is a reasoning model: without this it burns the whole
            # max_tokens budget on a hidden <think> block and returns no content.
            "reasoning_effort": "none",
            "max_tokens": 200,
        }

        attempt = 0
        while True:
            response = await self._http.post(_CHAT, headers=self._auth(key), json=body)
            if response.is_success:
                caption = (_first_content(response.json()) or "").strip()
                if not caption:
                    raise RuntimeError("Groq image captioning response returned empty content")
                return caption

            if response.status_code == 429 and attempt < _CAPTION_MAX_RETRIES:
                backoff_ms = min(_CAPTION_BACKOFF_BASE_MS * 2**attempt, _CAPTION_BACKOFF_CAP_MS)
                hint_ms = _retry_delay_ms(response, response.text) or 0
                wait_ms = max(backoff_ms, hint_ms) + random.random() * 250
                log.warning(
                    "captionImage: Groq rate-limited (429), retrying in %dms (attempt %d/%d)",
                    round(wait_ms),
                    attempt + 1,
                    _CAPTION_MAX_RETRIES,
                )
                await self._sleep(wait_ms / 1000)
                attempt += 1
                continue

            raise RuntimeError(
                f"Groq image captioning failed ({response.status_code}): {response.text}"
            )

    async def rewrite_query(self, query: str) -> str:
        if not self._api_key:
            return query
        try:
            async with asyncio.timeout(_REWRITE_TIMEOUT_S):
                response = await self._http.post(
                    _CHAT,
                    headers=self._auth(self._api_key),
                    json={
                        "model": self._rewrite_model,
                        "messages": [
                            {"role": "system", "content": _REWRITE_SYSTEM_PROMPT},
                            {"role": "user", "content": query},
                        ],
                        "temperature": 0.1,
                        "max_tokens": 150,
                        # gpt-oss-20b rejects "none"; "low" is the cheapest accepted value.
                        "reasoning_effort": "low",
                    },
                )
            if response.is_error:
                log.warning(
                    "rewriteQueryForRetrieval: Groq returned %d, using raw query",
                    response.status_code,
                )
                return query
            rewritten = _EDGE_QUOTES.sub("", (_first_content(response.json()) or "").strip())
            return rewritten or query
        except Exception as err:
            log.warning("rewriteQueryForRetrieval: failed (%s), using raw query", err)
            return query

    async def transcribe(self, audio: bytes, file_name: str = "audio.mp3") -> str:
        key = require(self._api_key, "GROQ_API_KEY")
        response = await self._http.post(
            _ASR,
            headers=self._auth(key),
            data={"model": self._asr_model or "whisper-large-v3", "response_format": "json"},
            files={"file": (file_name, audio)},
        )
        if response.is_error:
            raise RuntimeError(
                f"Groq transcription failed ({response.status_code} {response.reason_phrase}): "
                f"{response.text}"
            )
        text = response.json().get("text")
        if not text:
            raise RuntimeError("Groq transcription response missing text")
        return str(text)
