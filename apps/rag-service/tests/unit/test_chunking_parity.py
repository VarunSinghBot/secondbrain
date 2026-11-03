"""Parity with lib/text.ts, against fixtures from tests/fixtures/generate_fixtures.mjs."""

import json
from pathlib import Path
from typing import Any

import pytest

from app.domain.chunking import chunk_text, join_naturally, normalize_text, strip_html

FIXTURES: dict[str, Any] = json.loads(
    (Path(__file__).parent.parent / "fixtures" / "text.json").read_text(encoding="utf8")
)


@pytest.mark.parametrize("case", FIXTURES["stripHtml"], ids=lambda c: c["name"])
def test_strip_html(case: dict[str, Any]) -> None:
    assert strip_html(case["input"]) == case["output"]


@pytest.mark.parametrize("case", FIXTURES["normalizeText"], ids=lambda c: c["name"])
def test_normalize_text(case: dict[str, Any]) -> None:
    assert normalize_text(case["input"]) == case["output"]


@pytest.mark.parametrize("case", FIXTURES["chunkText"], ids=lambda c: c["name"])
def test_chunk_text(case: dict[str, Any]) -> None:
    got = [
        {"text": c.text, "index": c.index, "tokenCount": c.token_count}
        for c in chunk_text(case["input"], *case["args"])
    ]
    assert got == case["output"]


@pytest.mark.parametrize("case", FIXTURES["joinNaturally"], ids=lambda c: repr(c["input"]))
def test_join_naturally(case: dict[str, Any]) -> None:
    assert join_naturally(case["input"]) == case["output"]


def test_fixtures_exercise_multi_chunk_output() -> None:
    assert any(len(c["output"]) > 3 for c in FIXTURES["chunkText"])
