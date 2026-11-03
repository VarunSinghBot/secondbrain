# Handoff: resume at Phase 3

Branch `rag-service-python`. Spec: `PYTHON_PORT_PLAN.md` (one level above the repo, not in it).
A 1:1 port of `apps/rag-backend`: same Postgres, same Qdrant `rag_text` / `rag_images`, same
`RagDocument`. Run only one backend against a database at a time. Don't modify
`apps/rag-backend`, `apps/web/prisma/schema.prisma`, or the root `docker-compose.yml`.

## Done

| Phase | Commit | What |
|---|---|---|
| 1 | `d035a1a` | Scaffold, CI, `/health`, `app/domain/` (chunking, guardrails, citations, fusion) with fixture parity tests |
| 2 | `e7aee0d` | `clients/protocols.py` + fakes (`tests/fakes.py`), concrete Gemini, Groq, Qdrant, CLIP (in-process), Cloudinary, LlamaParse, OCR.space |

Last run: ruff, `ruff format --check` and mypy strict clean; 263 unit tests pass offline;
integration 15 pass, 2 skip (no Gemini key).

## BLOCKER: run this first in Phase 3, before any ingestion code

**"Batched Gemini embeddings give identical vectors" is unverified.** Both
`tests/integration/test_embed_and_upsert.py` tests skip without `GEMINI_API_KEY`. Only the
request shape is unit-tested (against a mock). The whole batching decision rests on this.

```
docker compose -f docker-compose.rag-service.yml up -d
uv run pytest tests/integration/test_embed_and_upsert.py -v      # needs GEMINI_API_KEY
```

It asserts batch vs single cosine > 0.9999, unit norm, and an embed -> upsert -> search round
trip. If it fails, ingestion must fall back to per-text `embed_text` calls (still concurrent).

## Env files

Both are gitignored, so a fresh clone lacks them. The owner keeps the real ones in their old
clone and copies them over: `apps/rag-backend/.env` (Groq, Gemini, LlamaParse, OCR.space,
Cloudinary, Qdrant, DB, secrets) and `apps/web/.env`. Neither was present in this clone as of
Phase 2. Don't copy secrets into the repo. `apps/rag-service/.env.example` lists the variable
names; make a local `.env` from it. If they're still missing when you need them, ask.

## Qdrant is v1.7.4 (constraint)

The server holding the real data is v1.7.4 (root `docker-compose.yml`). Consequences:

- `qdrant-client` is pinned `>=1.12,<1.16`. 1.20 removed `search`.
- Use `client.search(...)`, **not** `query_points` (needs server >= 1.10).
- Don't use `collection_exists` (server endpoint added in 1.8). `QdrantVectorStore` uses
  `get_collection` and treats 404 (or `ValueError` in in-memory mode) as missing.
- No sparse vectors, no hybrid. Out of scope anyway.
- Construct `AsyncQdrantClient(..., check_compatibility=False)`.
- `docker-compose.rag-service.yml` runs a throwaway v1.7.4 on port 6335 for integration tests.
  Tests use uniquely named collections and never touch `rag_text` / `rag_images`.
- Untested on 1.12+.

## CLIP vectors are unchanged

The old sidecar used transformers 4.41; this service uses 5.22. Embedded 3 images and 2 texts
in both: cosine 1.0 (6 dp) every time. Existing `rag_images` vectors stay valid. `torch`,
`transformers`, `pillow`, `numpy` are in the optional `clip` dependency group
(`uv sync --group clip`); CI and the unit suite don't install them.

## TS quirks ported as-is (1:1 fidelity)

1. **Tag vocabulary:** `config.ts` comments say 47 candidates; the sidecar has 58. Ported 58.
2. **Unreachable backoff cap:** `captionImage` caps backoff at 8000 ms, but with 3 retries the
   waits are 1, 2, 4 s, so the cap never applies (only a longer Retry-After hint exceeds it).
3. **REAL BUG, fix after cutover, not before:** query rewrite strips quotes with
   `/^["']|["']$/g`, which removes one from each end independently. A rewritten query
   `what's "this"` becomes `what's "this`. Ported unchanged, pinned by
   `test_rewrite_strips_exactly_one_quote_from_each_end` in `tests/unit/test_groq.py`. When
   fixing, change that test with it (strip only a matching surrounding pair).

Other known divergence: UTF-16 vs code-point string length in chunking (astral characters
only). Accepted; documented in `app/domain/chunking.py`.

## Phase 3: ingestion

Port `apps/rag-backend/src/services/indexer.ts` (`indexContent`, `recordIndexing`) branch for
branch, plus `lib/image.ts` (modes `"ocr"` and `"clip"`) and `lib/video.ts` (ffmpeg frames;
frame dedupe threshold 0.97; max 8 frames). Five types: PDF/document via LlamaParse, image,
audio via Whisper, video (frames + transcript + body text), plain text.

Start here:
1. Run the blocker above.
2. `app/clients/download.py`: port `lib/download.ts` (deferred from Phase 2; also needed by
   `/tag-image`).
3. `app/db/models.py` + `session.py`: map `RagDocument` (and `Content`, `User` if needed) from
   **`apps/web/prisma/schema.prisma`** (authoritative, 13 models; the `rag-backend` copy is a
   trimmed 3-model subset that dies with the TS service). Add `sqlalchemy[asyncio]`, `asyncpg`.
   Never migrate. `qdrantPointId` is `@unique`; `Content` relation is `onDelete: Cascade`.
4. `app/services/ingest.py` against the protocols, tests first with `tests/fakes.py`.
5. Batch embeds (`embed_batch`) and one upsert per document.
6. Port the file-backed job queue as-is (`worker/queue.ts`): mutex, atomic temp-file + rename,
   claim-then-process. Optional cheap addition from the plan: startup pass resetting stale
   `processing` jobs to `queued` and pruning completed jobs older than a day.

Known TS bug to fix while porting: image and video branches write `RagDocument` rows with a
`randomUUID()` never upserted to Qdrant, plus a status string as `extractedText`
(`indexer.ts:175, 257`), so they are skipped by every reindex. Record the point IDs actually
written.

Done when: an integration test ingests one fixture of each type and asserts point counts and
payload shape against what the TS service produces.

## Conventions (the owner's rules)

Tests first. Every external service behind a Protocol with a fake; the unit suite must pass
with no keys and no network. Integration tests are marked `integration`. At the end of each
phase run ruff, mypy and pytest, paste the real output, and stop for the owner's go. Don't
gold-plate. After a change, break it on purpose and check a test fails.
