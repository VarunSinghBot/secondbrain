# rag-service

FastAPI port of `apps/rag-backend`: same Postgres, same Qdrant collections (`rag_text`,
`rag_images`), same behaviour. Run only one of the two backends against a database at a time.

```
uv sync                                   # add --group clip for in-process CLIP (torch, ~2 GB)
uv run uvicorn app.main:app --port 8000
uv run pytest -m "not integration"        # offline: no keys, no network, no torch
uv run ruff check . && uv run mypy

docker compose -f docker-compose.rag-service.yml up -d   # throwaway Qdrant on :6335
uv run pytest -m integration              # skips whatever isn't available
```

Integration tests use uniquely named collections and never touch `rag_text` / `rag_images`.

`tests/fixtures/*.json` are generated from the TypeScript sources by
`node tests/fixtures/generate_fixtures.mjs` (Node >= 22.18). They are committed, so the
Python suite never needs Node.

Known divergence from the TS chunker: JS counts string length in UTF-16 units, Python in code
points, so chunk boundaries and `tokenCount` differ for text containing astral characters
(emoji and the like). See `app/domain/chunking.py`.
