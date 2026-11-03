import httpx

from app.errors import require


class OcrSpaceClient:
    """OCR.space, ported from extractOcrText in lib/image.ts (lib/ocr.ts is a dead shim)."""

    def __init__(self, http: httpx.AsyncClient, api_key: str) -> None:
        self._http = http
        self._api_key = api_key

    async def extract_text(self, image: bytes, file_name: str = "image.png") -> str:
        key = require(self._api_key, "OCR_SPACE_API_KEY")
        response = await self._http.post(
            "https://api.ocr.space/parse/image",
            data={"apikey": key, "language": "eng", "isOverlayRequired": "false"},
            files={"file": (file_name, image)},
        )
        if response.is_error:
            raise RuntimeError(
                f"OCR.Space request failed: {response.status_code} {response.reason_phrase}"
            )

        data = response.json()
        results = data.get("ParsedResults") or []
        parsed = ((results[0].get("ParsedText") if results else None) or "").strip()
        if not parsed:
            message = data.get("ErrorMessage")
            if isinstance(message, list):
                message = ", ".join(message)
            raise RuntimeError(message or "OCR.Space response missing text")
        return parsed
