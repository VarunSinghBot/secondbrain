"""Loads the real CLIP model (~600 MB download on first run). Needs the `clip` group."""

import io
import math

import pytest

pytest.importorskip("torch")
PIL_Image = pytest.importorskip("PIL.Image")

from app.clients.clip import TAG_CANDIDATES, ClipImageTagger  # noqa: E402


def png(color: tuple[int, int, int]) -> bytes:
    buf = io.BytesIO()
    PIL_Image.new("RGB", (64, 64), color).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(scope="module")
def tagger() -> ClipImageTagger:
    return ClipImageTagger()


async def test_image_and_text_embeddings_are_512d_unit_vectors(tagger: ClipImageTagger) -> None:
    for vec in (await tagger.embed_image(png((200, 30, 30))), await tagger.embed_text("a red box")):
        assert len(vec) == 512
        assert math.isclose(sum(x * x for x in vec), 1.0, abs_tol=1e-5)


async def test_text_matches_its_own_image_better_than_a_different_one(
    tagger: ClipImageTagger,
) -> None:
    red, blue = (
        await tagger.embed_image(png((220, 20, 20))),
        await tagger.embed_image(png((20, 20, 220))),
    )
    query = await tagger.embed_text("a plain red square")
    assert sum(a * b for a, b in zip(query, red, strict=True)) > sum(
        a * b for a, b in zip(query, blue, strict=True)
    )


async def test_tags_come_from_the_vocabulary_and_respect_top_n(tagger: ClipImageTagger) -> None:
    tags = await tagger.tag_image(png((20, 120, 200)))
    assert len(tags) <= 5
    assert set(tags) <= set(TAG_CANDIDATES)
