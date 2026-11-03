"""Parity with lib/guardrails.ts, against committed fixtures."""

import json
from pathlib import Path
from typing import Any

import pytest

from app.domain.guardrails import (
    RagSource,
    build_grounded_system_prompt,
    validate_context_relevance,
    validate_user_query,
)

FIXTURES: dict[str, Any] = json.loads(
    (Path(__file__).parent.parent / "fixtures" / "guardrails.json").read_text(encoding="utf8")
)


def to_source(raw: dict[str, Any]) -> RagSource:
    return RagSource(
        content_id=raw["contentId"],
        source_type=raw["sourceType"],
        text=raw["text"],
        score=raw["score"],
        modality=raw.get("modality"),
        caption=raw.get("caption"),
        cloudinary_url=raw.get("cloudinaryUrl"),
    )


@pytest.mark.parametrize("case", FIXTURES["validateUserQuery"], ids=lambda c: repr(c["input"])[:40])
def test_validate_user_query(case: dict[str, Any]) -> None:
    got = validate_user_query(case["input"])
    expected = case["output"]
    assert got.valid == expected["valid"] == expected["isValid"]
    assert got.sanitized_query == expected["sanitizedQuery"]
    assert got.reason == expected.get("reason") == expected.get("error")


@pytest.mark.parametrize("case", FIXTURES["validateContextRelevance"])
def test_validate_context_relevance(case: dict[str, Any]) -> None:
    sources = [to_source(s) for s in case["sources"]]
    got = (
        validate_context_relevance(sources)
        if case["minScore"] is None
        else validate_context_relevance(sources, case["minScore"])
    )
    expected = case["output"]
    assert got.has_sufficient_context == expected["hasSufficientContext"]
    assert got.max_score == expected["maxScore"]
    assert [s.score for s in got.filtered_sources] == [
        s["score"] for s in expected["filteredSources"]
    ]


@pytest.mark.parametrize("case", FIXTURES["buildGroundedSystemPrompt"])
def test_build_grounded_system_prompt(case: dict[str, Any]) -> None:
    assert build_grounded_system_prompt([to_source(s) for s in case["sources"]]) == case["output"]
