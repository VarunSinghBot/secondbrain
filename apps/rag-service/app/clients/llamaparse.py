import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from app.errors import require

_API = "https://api.cloud.llamaindex.ai/api/v2/parse"
_MAX_POLLS = 60
_POLL_INTERVAL_S = 2.0


def _flatten(data: dict[str, Any]) -> str:
    if isinstance(data.get("markdown_full"), str):
        return str(data["markdown_full"])
    if isinstance(data.get("text_full"), str):
        return str(data["text_full"])

    markdown = data.get("markdown")
    if isinstance(markdown, dict) and markdown.get("pages"):
        return "\n\n".join(p.get("markdown") or "" for p in markdown["pages"])

    text = data.get("text")
    if isinstance(text, dict) and text.get("pages"):
        return "\n\n".join(p.get("text") or "" for p in text["pages"])

    return ""


class LlamaParseClient:
    def __init__(
        self,
        http: httpx.AsyncClient,
        api_key: str,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._http = http
        self._api_key = api_key
        self._sleep = sleep

    async def parse_from_url(self, source_url: str) -> str:
        key = require(self._api_key, "LLAMA_CLOUD_API_KEY")
        headers = {"Authorization": f"Bearer {key}"}

        # "expand" is NOT accepted on creation (422 extra_forbidden); it is only valid
        # on the polling GET below, which is where markdown_full/text_full are requested.
        created = await self._http.post(
            _API,
            headers=headers,
            json={"source_url": source_url, "tier": "cost_effective", "version": "latest"},
        )
        if created.is_error:
            raise RuntimeError(
                f"LlamaParse job creation failed: {created.status_code} {created.reason_phrase}"
            )

        create_data = created.json()
        job_id = create_data.get("id") or (create_data.get("job") or {}).get("id")
        if not job_id:
            raise RuntimeError("LlamaParse response missing job id")

        for _ in range(_MAX_POLLS):
            polled = await self._http.get(
                f"{_API}/{job_id}?expand=markdown_full,text_full", headers=headers
            )
            if polled.is_error:
                raise RuntimeError(
                    f"LlamaParse polling failed: {polled.status_code} {polled.reason_phrase}"
                )

            data = polled.json()
            job = data.get("job") or {}
            status = job.get("status") or ""

            if status == "COMPLETED":
                text = _flatten(data)
                if not text:
                    raise RuntimeError("LlamaParse completed without text output")
                return text

            if status in ("FAILED", "CANCELLED"):
                raise RuntimeError(job.get("error_message") or f"LlamaParse job {status.lower()}")

            await self._sleep(_POLL_INTERVAL_S)

        raise RuntimeError("LlamaParse timed out while waiting for document parsing")
