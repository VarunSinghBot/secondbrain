"""Parity with the citation helpers in lib/guardrails.ts, against committed fixtures."""

import json
from pathlib import Path
from typing import Any

import pytest

from app.domain.citations import cited_source_indices, label_for_source, strip_citation_markers
from app.domain.guardrails import RagSource

FIXTURES: dict[str, Any] = json.loads(
    (Path(__file__).parent.parent / "fixtures" / "citations.json").read_text(encoding="utf8")
)


@pytest.mark.parametrize(
    "case", FIXTURES["citedSourceIndices"], ids=lambda c: repr(c["input"])[:40]
)
def test_cited_source_indices(case: dict[str, Any]) -> None:
    assert sorted(cited_source_indices(case["input"])) == case["output"]


@pytest.mark.parametrize(
    "case", FIXTURES["stripCitationMarkers"], ids=lambda c: repr(c["input"])[:40]
)
def test_strip_citation_markers(case: dict[str, Any]) -> None:
    assert strip_citation_markers(case["input"]) == case["output"]


@pytest.mark.parametrize("case", FIXTURES["labelForSource"], ids=lambda c: repr(c["source"])[-40:])
def test_label_for_source(case: dict[str, Any]) -> None:
    raw = case["source"]
    source = RagSource(
        content_id=raw["contentId"],
        source_type=raw["sourceType"],
        text=raw["text"],
        score=raw["score"],
        modality=raw.get("modality"),
        timestamp_seconds=raw.get("timestampSeconds"),
    )
    assert label_for_source(source) == case["output"]
