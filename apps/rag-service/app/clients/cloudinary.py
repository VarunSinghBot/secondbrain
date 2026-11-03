import hashlib
import time
from collections.abc import Callable

import httpx

from app.clients.protocols import ResourceType, UploadResult
from app.errors import require

_FOLDER = "multimodal_rag"


class CloudinaryStore:
    def __init__(
        self,
        http: httpx.AsyncClient,
        cloud_name: str,
        api_key: str,
        api_secret: str,
        now: Callable[[], float] = time.time,
    ) -> None:
        self._http = http
        self._cloud_name = cloud_name
        self._api_key = api_key
        self._api_secret = api_secret
        self._now = now

    async def upload(
        self, file: bytes, file_name: str, resource_type: ResourceType = "auto"
    ) -> UploadResult:
        cloud_name = require(self._cloud_name, "CLOUDINARY_CLOUD_NAME")
        api_key = require(self._api_key, "CLOUDINARY_API_KEY")
        api_secret = require(self._api_secret, "CLOUDINARY_API_SECRET")

        timestamp = str(int(self._now()))
        to_sign = f"folder={_FOLDER}&timestamp={timestamp}{api_secret}"
        signature = hashlib.sha1(to_sign.encode()).hexdigest()  # Cloudinary's signing scheme

        response = await self._http.post(
            f"https://api.cloudinary.com/v1_1/{cloud_name}/{resource_type}/upload",
            data={
                "api_key": api_key,
                "timestamp": timestamp,
                "folder": _FOLDER,
                "signature": signature,
            },
            files={"file": (file_name, file)},
        )
        if response.is_error:
            raise RuntimeError(
                f"Cloudinary upload failed ({response.status_code}): {response.text}"
            )

        data = response.json()
        return UploadResult(
            url=data["secure_url"],
            public_id=data["public_id"],
            format=data.get("format"),
            resource_type=data["resource_type"],
        )
