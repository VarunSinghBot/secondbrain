"""Port of apps/rag-backend/src/lib/text.ts.

Known divergence: JS measures strings in UTF-16 code units, Python in code points. For text
containing astral characters (emoji and the like) chunk boundaries and token_count therefore
differ slightly from the TS output. Accepted: it only affects newly ingested content, and
nothing needs byte-identical output once the TS service is switched off.
"""

import re
from dataclasses import dataclass

# JavaScript's \s and Python's differ (JS: U+FEFF yes; U+001C-1F and U+0085 no), so the
# set is spelled out to match lib/text.ts exactly.
_ASCII_WS = range(9, 14)
_UNICODE_WS = [0xA0, 0x1680, *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000]
_WS_CHARS = frozenset(map(chr, [*_ASCII_WS, 0x20, *_UNICODE_WS, 0xFEFF]))
_WS_RUN = re.compile(f"[{re.escape(''.join(_WS_CHARS))}]+")
_SCRIPT = re.compile(r"<script[\s\S]*?</script>", re.IGNORECASE | re.ASCII)
_STYLE = re.compile(r"<style[\s\S]*?</style>", re.IGNORECASE | re.ASCII)
_TAG = re.compile(r"<[^>]+>")
_NBSP = re.compile(r"&nbsp;", re.IGNORECASE | re.ASCII)

_WORD_BOUNDARY_SEARCH_WINDOW = 50


@dataclass(frozen=True)
class Chunk:
    text: str
    index: int
    token_count: int


def js_trim(s: str) -> str:
    return s.strip("".join(_WS_CHARS))


def join_naturally(items: list[str]) -> str:
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return f"{', '.join(items[:-1])}, and {items[-1]}"


def strip_html(text: str) -> str:
    text = _SCRIPT.sub(" ", text)
    text = _STYLE.sub(" ", text)
    return _TAG.sub(" ", text)


def normalize_text(text: str) -> str:
    text = _NBSP.sub(" ", strip_html(text))
    return js_trim(_WS_RUN.sub(" ", text))


def _snap_to_word_boundary(text: str, pos: int, min_pos: int) -> int:
    """Nudge a cut back to the nearest preceding whitespace, within 50 chars."""
    if pos >= len(text) or text[pos] in _WS_CHARS:
        return pos
    floor = max(min_pos, pos - _WORD_BOUNDARY_SEARCH_WINDOW)
    for i in range(pos, floor, -1):
        if text[i - 1] in _WS_CHARS:
            return i
    return pos


def chunk_text(text: str, chunk_size: int = 1200, overlap: int = 150) -> list[Chunk]:
    normalized = normalize_text(text)
    if not normalized:
        return []

    chunks: list[Chunk] = []
    start = 0
    index = 0

    while start < len(normalized):
        raw_end = min(len(normalized), start + chunk_size)
        end = (
            raw_end
            if raw_end == len(normalized)
            else _snap_to_word_boundary(normalized, raw_end, start)
        )
        chunk = js_trim(normalized[start:end])

        if chunk:
            chunks.append(Chunk(text=chunk, index=index, token_count=-(-len(chunk) // 4)))
            index += 1

        if end == len(normalized):
            break

        snapped_start = _snap_to_word_boundary(normalized, max(0, end - overlap), 0)
        start = snapped_start if snapped_start > start else end

    return chunks
