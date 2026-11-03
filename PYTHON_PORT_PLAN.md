# SecondBrain — port the RAG backend to Python

Replace `apps/rag-backend` (Express/TypeScript) with `apps/rag-service`
(FastAPI/Python). Same behaviour, same database, same Qdrant collections.
A straight port, not a redesign.

Phase 1 is already done. Four phases remain.

---

## Scope

**In:** a 1:1 Python port of the RAG backend, absorbing `clip-sidecar/`.

**Out:** hybrid retrieval, rank fusion, reranking, the eval harness,
side-by-side collections, v2 tables, parity testing against the running TS
service. All of that existed to let two backends coexist or to improve
retrieval quality. Neither is the goal now. It can be added later against a
working Python service — easier then than now.

**Three changes that aren't 1:1,** because they're free or forced:

| Change | Why it's not optional |
|---|---|
| CLIP runs in-process | The reason for the port. Deletes `clip-sidecar/`, removes an HTTP round trip per video frame and the 503 failure path |
| Batched Gemini embeddings | Identical vectors, ~10× faster ingestion. Writing the serial loop on purpose would be perverse |
| `hmac.compare_digest` for secrets | One line. The TS `!==` isn't constant-time |

Everything else — chunking, thresholds, scoring, the per-modality cap, the
prompt, citation parsing — ports as-is, including the parts I'd otherwise
argue against.

## Key simplification: same data, same collections

The Python service reads and writes `rag_text`, `rag_images` and
`RagDocument` exactly as the TypeScript one does.

- **No re-ingest.** Existing vectors keep working. Same Gemini model, same
  `taskType`, same `outputDimensionality` → identical embeddings.
- **No new tables.** No Prisma schema change.
- **No RagDocument conflict.** Only one service ever writes it.
- **Cutover is one env var**, and rollback is changing it back.

The only rule: **don't run both backends against the same database at once.**
`recordIndexing` deletes `RagDocument` rows by `contentId` with no other
filter, so two writers would wipe each other's rows. Run one at a time.

## Constraints

- Don't modify `apps/rag-backend/` until cutover. It stays runnable as the
  rollback path.
- Don't modify `apps/web/prisma/schema.prisma`. Map the existing tables with
  SQLAlchemy; never migrate them.
- Match the HTTP contract below so `apps/web` works with only
  `RAG_BACKEND_URL` changed.
- `apps/rag-backend/prisma/schema.prisma` is a trimmed 3-model copy
  (`User`, `Content`, `RagDocument`) used only to generate that service's own
  Prisma client. `apps/web`'s 13-model schema is authoritative. The copy dies
  with the TS service.

## Stack

| Concern | Choice |
|---|---|
| Framework | FastAPI + uvicorn |
| Validation | Pydantic v2 |
| Database | SQLAlchemy 2.0 async + asyncpg, mapping existing tables |
| Vectors | `qdrant-client` (async) |
| Images | `transformers` CLIP, in-process |
| Queue | Port the file-backed queue as-is (see §Queue) |
| Tests | pytest + pytest-asyncio |
| Lint/types | ruff + mypy strict |
| Packaging | uv |

No Redis, no Alembic, no new infrastructure.

## HTTP contract

`apps/rag-backend/src/index.ts` is the source of truth — `packages/types`
covers only half the surface.

| Route | Method | Auth |
|---|---|---|
| `/health` | GET | none |
| `/index` | POST | `x-internal-secret` |
| `/reindex` | POST | `x-internal-secret` |
| `/ask` | POST | `x-internal-secret` |
| `/verify` | POST | `x-internal-secret` |
| `/delete` | POST | `x-internal-secret` |
| `/tag-image` | POST | `x-internal-secret` |
| `/ingest-async` | POST | `x-internal-secret` |
| `/ingest-async/{job_id}` | GET | `x-internal-secret` |
| `/admin/reset-collections` | POST | `x-admin-secret` |
| `/admin/inspect` | GET | `x-admin-secret` |

Details that are part of the contract:

- `/index` returns **202** for video (queued), **201** otherwise.
- `/ask` returns 400 for guardrail rejections, 500 otherwise. The TS version
  decides by regex-matching the error message (`index.ts:150`); use typed
  exceptions producing the same codes.
- `/tag-image` and `/index` return **503** when CLIP is unavailable. In
  Python, CLIP is in-process, so 503 now means "model failed to load" rather
  than "sidecar down". Keep the status code.

## Source notes

Checked against commit `a9dceec`:

- Sequential `await embedText`: `indexer.ts` lines **126, 195, 238, 277** →
  batched.
- **OCR lives in `lib/image.ts:10`** (`extractOcrText`, OCR.space).
  `lib/ocr.ts` is a 60-byte re-export shim nothing imports — don't port it.
- `image.ts` has `"ocr"` and `"clip"` modes (`image.ts:50, 67`). Port both.
- Keep the fallback-caption filter in `askWithRag`. It solves a real problem.
- Keep the full-width `【1】` / `【1†L1-L2】` citation handling
  (`guardrails.ts:132`) — a real `gpt-oss-120b` quirk.
- `RagDocument.qdrantPointId` is `@unique` and the `Content` relation is
  `onDelete: Cascade`. Both matter when writing rows.

## Known bug to fix during the port

The image and video branches write `RagDocument` rows with a `randomUUID()`
that was never upserted to Qdrant, plus a status string as `extractedText`
(`indexer.ts:175, 257`). Because those rows carry the current
`embeddingModel`, `reindexUserContent` treats them as fresh and skips them —
so images and video are silently excluded from every reindex.

Record the point IDs actually written. This is a bug fix, not a behaviour
change, and it's cheap while the code is being rewritten anyway.

## Queue

Port the file-backed queue as-is: mutex, atomic temp-file-plus-rename,
claim-then-process. It's correctly written for what it is.

Its limits stay: one worker, single process, jobs stuck in `processing`
forever if the process dies, unbounded file growth. If you want one cheap
improvement, add a startup pass that resets stale `processing` jobs to
`queued` and prunes completed jobs older than a day — roughly 20 lines, and
it fixes the only failure mode you'd actually hit.

A Postgres-backed queue with `FOR UPDATE SKIP LOCKED` fixes all of it
properly, but it needs Alembic and a new table. Deferred.

## Phases

**Phase 1 — done.** Scaffold, CI, `/health`, and `domain/` (chunking,
guardrails, citations, fusion) with fixture-based parity tests. 173 tests
passing.

Note on the known UTF-16 vs code-point divergence: **leave it.** It only
affects chunk boundaries for astral characters, only for newly-ingested
content, and nothing requires byte-identical output with the TS service once
it's switched off. Document it in the module and move on.

**Phase 2 — clients.** `clients/protocols.py` with `Embedder`, `VectorStore`,
`LLM`, `Transcriber`, `DocumentParser`, `ImageTagger`, `MediaStore`. Fakes for
each. Concrete clients: Gemini (with batch), Groq (chat + Whisper), Qdrant,
CLIP in-process, Cloudinary, LlamaParse, OCR.space.

Done when: unit suite green with no keys and no network; a marked integration
test embeds and upserts against local Qdrant.

**Phase 3 — ingestion.** All five content types, matching `indexer.ts`
branch for branch: PDF via LlamaParse, images in both modes, audio via
Whisper, video (frames + transcript + body text), plain text. Batched
embeddings and upserts. Real point IDs in `RagDocument`. Port the job queue.

Done when: an integration test ingests a fixture of each type and asserts
point counts and payload shape against what the TS service produces.

**Phase 4 — retrieval and routes.** Port `askWithRag` exactly: query
validation, Groq query rewrite, parallel dense text + CLIP image search,
fallback-caption filter, the score floors, the image-focused rebalance, the
per-modality cap, the minimum-overall gate, citation parsing. Then all 11
routes with the right status codes.

Done when: the same question against both services returns comparable answers
with the same citations.

**Phase 5 — cutover.** Point `RAG_BACKEND_URL` at the Python service. Verify
the web app end to end: create a note, ingest each content type, ask a
question, check citations. Then stop `clip-sidecar`, confirm image ingestion
still works, and delete `apps/rag-backend/` and `clip-sidecar/` in a separate
commit so the revert is clean.

## Later, once this works

In rough order of value: hybrid retrieval with BM25 + RRF + a cross-encoder
reranker (replaces the hand-tuned thresholds with one model score), an eval
harness to measure it, a Postgres job queue, and contextual chunk headers.
Each is easier against a working Python service than bundled into the port.
