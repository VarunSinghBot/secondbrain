# rag-service

FastAPI replacement for `apps/rag-backend`. Writes to its own Qdrant collections
(`rag_text_v2`, `rag_images_v2`); the TypeScript backend is unaffected.

```
uv sync
uv run uvicorn app.main:app --port 8000
uv run pytest -m "not integration"      # offline: no keys, no network
uv run ruff check . && uv run mypy
```

`tests/fixtures/*.json` are generated from the TypeScript sources by
`node tests/fixtures/generate_fixtures.mjs` (Node >= 22.18). They are committed, so the
Python suite never needs Node.
