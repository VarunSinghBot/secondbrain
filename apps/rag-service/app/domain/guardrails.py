import math
import re
from dataclasses import dataclass, field

from app.domain.chunking import js_trim

DEFAULT_MIN_RELEVANCE_SCORE = 0.5

_INJECTION_PATTERNS = [
    re.compile(p, re.IGNORECASE | re.ASCII)
    for p in (
        r"ignore previous instructions",
        r"system prompt override",
        r"forget all rules",
        r"bypass safety",
    )
]


@dataclass
class RagSource:
    content_id: str
    source_type: str
    text: str
    score: float
    user_id: str | None = None
    source_name: str | None = None
    source_url: str | None = None
    cloudinary_url: str | None = None
    modality: str | None = None
    chunk_index: int | None = None
    tags: list[str] = field(default_factory=list)
    caption: str | None = None
    timestamp_seconds: float | None = None
    is_fallback: bool = False


@dataclass(frozen=True)
class QueryValidation:
    valid: bool
    sanitized_query: str
    reason: str | None = None


@dataclass(frozen=True)
class ContextCheck:
    has_sufficient_context: bool
    filtered_sources: list[RagSource]
    max_score: float


def validate_user_query(query: str) -> QueryValidation:
    if not query:
        return QueryValidation(False, "", "Query must be a non-empty string.")

    sanitized = js_trim(query)
    if not sanitized:
        return QueryValidation(False, "", "Query cannot be empty.")

    if len(sanitized) > 2000:
        return QueryValidation(
            False, "", "Query exceeds maximum allowed length of 2000 characters."
        )

    if any(p.search(sanitized) for p in _INJECTION_PATTERNS):
        return QueryValidation(False, sanitized, "Query contains restricted injection patterns.")

    return QueryValidation(True, sanitized)


def validate_context_relevance(
    sources: list[RagSource], min_score: float = DEFAULT_MIN_RELEVANCE_SCORE
) -> ContextCheck:
    filtered = [s for s in sources if s.score >= min_score]
    return ContextCheck(
        has_sufficient_context=bool(filtered),
        filtered_sources=filtered,
        max_score=max([0.0, *(s.score for s in sources)]),
    )


def _format_score(score: float) -> str:
    # Math.round(x * 1e4) / 1e4 then JS number->string: half rounds up (not
    # banker's) and whole numbers print without ".0".
    rounded = math.floor(score * 10000 + 0.5) / 10000
    return str(int(rounded)) if rounded == int(rounded) else repr(rounded)


def build_grounded_system_prompt(sources: list[RagSource]) -> str:
    parts: list[str] = []
    for idx, s in enumerate(sources):
        cld = f" | url: {s.cloudinary_url}" if s.cloudinary_url else ""
        mod = (s.modality or s.source_type or "TEXT").upper()
        body = s.text or s.caption or "No text available"
        parts.append(f"[{idx + 1}] [{mod}] score={_format_score(s.score)}{cld}\n{body}")

    context = "\n\n".join(parts) if parts else "No relevant context found in the knowledge base."

    return "\n".join(
        [
            "You are a precise AI assistant with access to a personal multimodal knowledge base.",
            "The knowledge base contains text notes, documents, image descriptions, audio "
            "transcripts, and video content.",
            "Answer the user's question using ONLY the provided context snippets.",
            "If the context is insufficient or missing, state clearly: 'I could not find "
            "sufficient context in your knowledge base to answer this question accurately.' "
            "— do not hallucinate.",
            "Cite the source index like [1], [2] when you use a context snippet.",
            "Do not paste raw URLs into your answer — the source link is already shown to the "
            "user separately via the citation.",
            "",
            "Answer in plain conversational prose, as if speaking to the user directly.",
            "Synthesize the retrieved snippets into a natural answer — do not restate them "
            "field by field (e.g. do not write 'Title: ... Content: ... Tags: ...').",
            "Do not use markdown headers or bold text unless the user's question itself asks "
            "for a structured list or comparison.",
            "",
            f"CONTEXT:\n{context}",
        ]
    )
