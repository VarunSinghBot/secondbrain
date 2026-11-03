import math
import re

from app.domain.chunking import js_trim
from app.domain.guardrails import RagSource

# gpt-oss-120b emits "[1]", full-width "【1】" and "【1†L1-L2】": match any digit run
# right after an opening bracket, whatever precedes the closing one. [0-9], not \d,
# because JS \d is ASCII-only.
_CITATION = re.compile(r"[\[【]([0-9]+)[^\]】]*[\]】]")
_FULL_WIDTH_CITATION = re.compile(r"【[0-9]+[^】]*】")
_MULTI_BLANK = re.compile(r"[ \t]{2,}")


def cited_source_indices(answer: str) -> set[int]:
    return {int(m.group(1)) for m in _CITATION.finditer(answer)}


def strip_citation_markers(answer: str) -> str:
    """Drop full-width markers; call after cited_source_indices() has read them."""
    answer = _FULL_WIDTH_CITATION.sub("", answer)
    return js_trim(_MULTI_BLANK.sub(" ", answer))


def _format_timestamp(total_seconds: float) -> str:
    minutes = math.floor(total_seconds / 60)
    seconds = math.floor(math.fmod(total_seconds, 60))
    return f"{minutes}:{seconds:02d}"


def label_for_source(source: RagSource) -> str:
    modality = (source.modality or source.source_type or "text").lower()

    if modality == "video_frame":
        ts = source.timestamp_seconds
        return (
            f"Video frame source (at {_format_timestamp(ts)})"
            if ts is not None
            else "Video frame source"
        )
    if modality == "image":
        return "Image source"
    if modality == "audio":
        return "Audio source"
    if modality == "video":
        return "Video source"
    if modality == "video_audio":
        return "Video transcript source"
    return "Note source"
