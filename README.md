# SecondBrain

Multimodal notes with retrieval-augmented question answering over your own content.

![pnpm](https://img.shields.io/badge/pnpm-11.20.0-F69220?style=flat-square&logo=pnpm&logoColor=white)
![Turborepo](https://img.shields.io/badge/Turborepo-monorepo-EF4444?style=flat-square&logo=turborepo&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Environment variables](#environment-variables)
- [Setup & run](#setup--run)
- [Project structure](#project-structure)
- [Known Discrepancies & Notes](#known-discrepancies--notes)

SecondBrain is a multimodal, multi-tenant note-taking application. Users capture
notes as text, images, audio, video, or PDF documents, organize them with tags,
and share them with friends. At its core, users ask natural-language questions
and get answers grounded in their own content via a retrieval-augmented
generation (RAG) pipeline, with citations back to the source note. It solves the
problem of a personal knowledge base becoming write-only — content that's easy
to save but hard to recall later, especially across formats (a fact buried in a
video transcript, a diagram in a photo, a paragraph in a PDF).

The project is a Turborepo/pnpm monorepo: a Next.js full-stack app for
auth/CRUD/UI, a dedicated Express service for the RAG pipeline, a small WebSocket
service for direct messages, and a separate Python sidecar for CLIP image
embeddings.

## Features

Everything below is implemented and verified against the current code — nothing
speculative.

- **Auth** — email/password (bcrypt-hashed) and Google OAuth via NextAuth v5.
- **5 content types** — article (rich text), image, audio, video, document (PDF),
  each with a dedicated ingestion path.
- **Dashboard** — search by title/body/tag, filter by content type, 4 themes
  (light/dark/sepia/ocean) and 3 layouts (compact/comfortable/spacious), persisted
  per-browser.
- **Tagging** — manual tags plus AI-suggested tags for images (OCR text, CLIP
  visual tags, and a Groq text call, combined).
- **Sharing** — public share links and direct note-to-friend sharing, separate
  from the friends/DM social layer.
- **Social layer** — friend requests, friendships, direct messages over a
  WebSocket connection, comments on notes.
- **Multimodal RAG ingestion** — text is chunked directly; audio/video are
  transcribed (Groq Whisper); images are captioned (Groq vision model) and/or
  OCR'd and CLIP-embedded; PDFs are parsed to markdown (LlamaParse) then chunked.
  All chunks are embedded (Gemini) and stored per-user in Qdrant.
- **Query rewrite before retrieval** — the user's raw question is passed through
  one small, fast Groq call that fixes spelling/grammar/typos and expands
  nothing else (no invented specifics, no scope change) before it's embedded for
  search. The *original* question — not the rewritten one — is still what's
  sent to answer generation and shown to the user, so answers read naturally. If
  the rewrite call errors out or times out (3s budget), retrieval silently falls
  back to the raw query; this can't become a new point of failure for `/ask`.
- **Grounded question answering** — retrieval across both the text and image
  vector collections, per-modality relevance thresholds, a per-modality cap on
  how many hits reach the LLM, and a minimum-overall-score gate that returns "I
  could not find sufficient context" instead of letting the LLM answer
  ungrounded. Answers cite sources with `[1]`, `[2]`, etc.
- **Per-user isolation** — every Qdrant query and write is filtered/scoped by
  `userId`; a service-to-service shared secret (`RAG_INTERNAL_SECRET`) gates
  every request from `apps/web` to `apps/rag-backend`.
- **Async ingestion for slow content** — video ingestion (download + ffmpeg +
  per-frame captioning) is routed to a background job automatically instead of
  blocking the request; job status is pollable.
- **Reindexing** — a batch endpoint that re-embeds a user's content if it's
  missing from Qdrant or was indexed under a since-changed embedding model.
- **Admin inspection** — secret-gated endpoints to scroll a user's raw vector
  points and to wipe/recreate the Qdrant collections during development.

## Architecture

### Monorepo layout

```text
apps/web            Next.js 15 (App Router) — the full-stack app: UI, auth,
                     CRUD API routes, Prisma (social/content schema), calls
                     out to rag-backend and chat-backend over HTTP/WS.
apps/rag-backend     Express/TypeScript — the RAG engine: ingestion, embedding,
                     Qdrant retrieval, Groq answer generation, guardrails.
                     Owns its own trimmed Prisma schema against the same DB.
apps/chat-backend    A minimal `ws`-based WebSocket server for direct messages.
packages/types       Shared TypeScript types (ContentType, RAG request/response
                     shapes, etc.) consumed by web and rag-backend.
clip-sidecar/        Python/FastAPI service (not a pnpm workspace member) that
                     runs CLIP (openai/clip-vit-base-patch32) for image
                     embeddings and zero-shot tagging.
prototypes/          Historical reference notebook, superseded by
                     apps/rag-backend — not executed or maintained.
```

### RAG pipeline

Ingestion is per-content-type: text chunks directly; audio/video go through
Whisper transcription (plus, for video, ffmpeg frame sampling and per-frame
captioning); images are captioned and/or OCR'd and CLIP-embedded; PDFs go
through LlamaParse first. Every text/caption chunk is split into ~1200-character
pieces with 150 characters of overlap (snapped to word boundaries), embedded via
Gemini (`gemini-embedding-001`), and written to Qdrant with a `userId` filter.
Video is the one content type slow enough to be routed through an internal
background job instead of processed inline (see "Background jobs" below — this
is a small custom queue, not an external broker).

```text
 INGESTION                                    QUERY (POST /ask)
 ─────────                                    ─────────────────
 raw content                                  raw user question
     │                                             │
     ▼                                             ▼
 per-modality extraction                    input guardrail
  (Whisper / OCR+CLIP /                     (length, injection filter)
   Groq caption / LlamaParse)                      │
     │                                             ▼
     ▼                                    query rewrite (small/fast Groq call)
 chunk (~1200 chars, 150 overlap)          — spelling/grammar only, falls back
     │                                       to the raw query on any failure —
     ▼                                             │
 embed (Gemini / CLIP)                             ▼
     │                                    embed rewritten query (Gemini + CLIP)
     ▼                                             │
 upsert → Qdrant (rag_text / rag_images)           ▼
     │                                    Qdrant search (text + image hits,
     ▼                                     scoped to userId)
 (video only: the extraction-through-                │
  upsert steps above run in the async                ▼
  job queue instead of inline — status       per-modality relevance filter +
  via GET /ingest-async/:jobId)              per-modality cap + overall-score gate
                                                     │
                                                     ▼
                                            grounded system prompt (numbered
                                            sources) → Groq LLM
                                                     │
                                                     ▼
                                            answer (cites [1][2]…) — generated
                                            against the ORIGINAL question, not
                                            the rewritten one
```

### Background jobs

`apps/rag-backend` has a small in-process job queue (`src/worker/queue.ts`): jobs
are written to a JSON file (`.rag_jobs.json` by default), a `setTimeout`-based
poller picks them up and calls the same `indexContent()` used for synchronous
ingestion, and status is queryable via `GET /ingest-async/:jobId`. **This is not
BullMQ and does not use Redis** — there is no message broker or external queue
service in this codebase; it's a self-contained file-backed queue, deliberately
lightweight.

### Vector storage

Vectors live in **Qdrant** (two collections: `rag_text` for note/audio/video/PDF
chunks and image/video-frame captions, `rag_images` for CLIP image embeddings),
either Qdrant Cloud or self-hosted via the repo's `docker-compose.yml`.
PostgreSQL is used separately, purely as a relational tracking store — the
`RagDocument` table records which content chunks were indexed, under which
embedding model, and their status. **There is no pgvector extension or vector
column anywhere in either Prisma schema**; Postgres never stores or searches
embeddings itself.

### Embeddings

There's no separate provider-abstraction package. `apps/rag-backend/src/lib/embeddings.ts`
calls Google's Gemini `embedContent` API directly (`gemini-embedding-001`,
truncated to `QDRANT_VECTOR_SIZE` dimensions and manually renormalized, per
Google's documented caveat for truncated output). Image vectors come from a
separate path: `apps/rag-backend/src/lib/clip-client.ts` calls the CLIP sidecar
over HTTP.

## Tech stack

Inferred from the actual dependencies in each `package.json`.

**apps/web** — Next.js 15 (App Router), React 19, NextAuth 5 (beta,
Credentials + Google), Prisma 7 (`@prisma/adapter-pg`) + PostgreSQL, Redux
Toolkit, Tailwind CSS 3, react-hot-toast, lucide-react, bcrypt, Cloudinary SDK,
Zod.

**apps/rag-backend** — Express 5, TypeScript, `ts-node-dev` (dev), Prisma 7
(separate schema/client) + PostgreSQL, Groq API (chat completions for answer
generation and query rewrite, Whisper for ASR, a vision model for captioning),
Google Gemini embeddings API, Qdrant (`fetch`-based client, no SDK dependency),
Cloudinary, LlamaParse (PDF parsing), OCR.space, `fluent-ffmpeg`, Vitest.

**apps/chat-backend** — `ws` (WebSocket server), nothing else.

**clip-sidecar** — Python, FastAPI, PyTorch, Hugging Face Transformers
(`openai/clip-vit-base-patch32`), Pillow.

**Tooling** — Turborepo, pnpm workspaces, TypeScript throughout the Node
services.

## Prerequisites

- **Node.js** — no `engines` field is pinned in any `package.json`; every
  package specifies `@types/node ^22.20.0`, which indicates Node 22+ is the
  intended runtime (inferred, not an enforced requirement).
- **pnpm 11.20.0** — pinned exactly via the root `package.json`'s
  `packageManager` field.
- **PostgreSQL** — a plain database, no extensions required. Used for
  auth/content/social data (`apps/web`) and RAG indexing-state tracking
  (`apps/rag-backend`); both apps point at the same `DATABASE_URL`.
- **Qdrant** — cloud cluster or self-hosted (`docker-compose.yml` includes a
  `qdrant` service). This is where note/image vectors actually live.
- **Python 3.10 + pip** — only if you're running the CLIP sidecar locally
  (needed for CLIP-mode image tagging; other content types and OCR-mode image
  ingestion work without it).
- **ffmpeg / ffprobe on PATH** — required on the machine running
  `apps/rag-backend` for video ingestion (frame sampling + audio extraction).
  Not needed for any other content type.
- **API keys** — Groq, Google Gemini, Cloudinary, LlamaParse, OCR.space, and a
  Google OAuth client. See the environment variable tables below for exactly
  which app needs which key.
- Redis is **not** required — despite what you might expect from a job-queue
  feature, nothing in this codebase reads a Redis connection string (see
  "Background jobs" above).

## Environment variables

### apps/web (`apps/web/.env`, from `apps/web/.env.example`)

| Variable | Purpose | Default |
| :-- | :-- | :-- |
| `DATABASE_URL` | Postgres connection string | none — required |
| `AUTH_SECRET` | NextAuth session/JWT signing secret (generate with `npx auth secret`) | none — required |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth login | none — required |
| `NEXT_PUBLIC_BASE_URL` | Public base URL of the web app | none — required |
| `NEXT_PUBLIC_CHAT_URL` | Base URL the browser uses to open the chat WebSocket | none — required |
| `RAG_BACKEND_URL` | Base URL of `apps/rag-backend` | none — required |
| `RAG_INTERNAL_SECRET` | Shared secret sent as `x-internal-secret` on every call to rag-backend | none — required, must match rag-backend's value exactly |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Media upload storage | none — required |

Two additional variables are read directly by `apps/web/app/api/tags/suggest/route.ts`
(AI tag suggestions for images) but are **not** in `.env.example`: `GROQ_API_KEY`
(for the tag-generation LLM call) and `OCR_SPACE_API_KEY` (falls back to a
shared public demo key if unset). Both are optional — the route degrades to
fewer/no suggested tags without them, it doesn't error.

### apps/rag-backend (`apps/rag-backend/.env`, from `apps/rag-backend/.env.example`)

| Variable | Purpose | Default |
| :-- | :-- | :-- |
| `RAG_BACKEND_PORT` | Port the Express server listens on | `3000` in code if unset — set this explicitly (`.env.example` uses `8090`) to avoid colliding with apps/web's own port 3000 |
| `DATABASE_URL` | Postgres connection string (RagDocument tracking only, not vectors) | none — required |
| `RAG_INTERNAL_SECRET` | Shared secret required on every request from apps/web | none — required, every request is rejected without it |
| `GROQ_API_KEY` | Auth for all Groq calls | none — required |
| `GROQ_LLM_MODEL` | Answer-generation model | `openai/gpt-oss-120b` |
| `GROQ_ASR_MODEL` | Whisper model for audio/video transcription | `whisper-large-v3` |
| `GROQ_CAPTION_MODEL` | Vision model for image/video-frame captioning | `qwen/qwen3.6-27b` |
| `GROQ_QUERY_REWRITE_MODEL` | Small/fast model for the pre-retrieval query rewrite step | `openai/gpt-oss-20b` |
| `GEMINI_API_KEY` | Auth for Gemini embeddings | none — required |
| `QDRANT_URL` / `QDRANT_API_KEY` | Vector database connection | none — required |
| `QDRANT_COLLECTION` | Text/caption vector collection name | `rag_text` |
| `QDRANT_IMAGE_COLLECTION` | Image vector collection name | `rag_images` |
| `QDRANT_VECTOR_SIZE` | Embedding output dimensionality | `768` |
| `CLIP_SIDECAR_URL` | URL of the local CLIP FastAPI service | `http://localhost:8001` |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Media upload storage (rag-backend uploads independently of apps/web) | none — required |
| `OCR_SPACE_API_KEY` | OCR text extraction for images | none — required for image ingestion (no fallback key here, unlike apps/web's tag-suggest route) |
| `LLAMA_CLOUD_API_KEY` | LlamaParse PDF-to-markdown parsing | none — required for document (PDF) ingestion |
| `ADMIN_SECRET` | Gates `POST /admin/reset-collections` and `GET /admin/inspect` | none — those endpoints return 401 if unset |
| `MIN_RELEVANCE_SCORE` | Relevance floor for text/note hits | `0.5` |
| `CLIP_IMAGE_MIN_SCORE` | Relevance floor for raw CLIP image hits (separate scale from the above) | `0.17` |
| `IMAGE_TAG_SCORE_THRESHOLD` | Floor for image/video-frame caption chunks living in the text collection | `0.52` |
| `IMAGE_FOCUSED_TEXT_SCORE_THRESHOLD` | Stricter text floor applied when a query looks image-focused | `0.5` |
| `MIN_OVERALL_SCORE` | Overall gate — below this, nothing is considered relevant and `/ask` returns a "no context" answer instead of calling the LLM | `0.45` |
| `CLIP_TAG_THRESHOLD` / `CLIP_TAG_TOP_N` | Zero-shot CLIP tagging score floor / max tags kept — only relevant if `USE_CLIP_ZEROSHOT_TAGGING=true` | `0.19` / `5` |
| `MAX_VIDEO_FRAMES` | Keyframes sampled per video | `8` |
| `VIDEO_FRAME_DEDUPE_THRESHOLD` | Cosine-similarity threshold above which a sampled frame is dropped as a near-duplicate | `0.97` |
| `USE_CLIP_ZEROSHOT_TAGGING` | Use CLIP's fixed-vocabulary tagging instead of Groq free-text captioning | `false` |
| `RAG_JOBS_FILE` | Internal test seam — path for the background-job JSON store | `.rag_jobs.json` in the process's cwd |

### apps/chat-backend

No `.env.example` exists for this package — it reads exactly one environment
variable, directly from `process.env`, with no `.env` file loading at all:

| Variable | Purpose | Default |
| :-- | :-- | :-- |
| `CHAT_PORT` | Port the WebSocket server listens on | `8080` in code |

**This needs manual attention.** `apps/web`'s `NEXT_PUBLIC_CHAT_URL` defaults to
`http://localhost:5174` in its `.env.example`, but `apps/chat-backend` itself
defaults to port `8080` if `CHAT_PORT` isn't set. Export `CHAT_PORT=5174` (or
whatever port matches your `NEXT_PUBLIC_CHAT_URL`) in the shell you run `pnpm dev`
from, or direct messages won't connect.

## Setup & run

Every command below corresponds to a real script in a `package.json` or
`turbo.json` — verified against the actual files, not written from memory.

```bash
# 1. Install workspace dependencies (pnpm workspaces: apps/* + packages/*)
pnpm install

# 2. Create env files from the real examples and fill in values
cp apps/web/.env.example apps/web/.env
cp apps/rag-backend/.env.example apps/rag-backend/.env
# apps/rag-backend reads `.env` specifically (plain dotenv.config()) — not
# `.env.local`. Get AUTH_SECRET via:
npx auth secret

# 3. Push apps/web's Prisma schema (creates all tables, including the shared
#    RagDocument table rag-backend also reads) and generate both Prisma clients
pnpm db:push
pnpm db:generate

# 4. Start Qdrant if you're not pointing at a cloud cluster
docker compose up -d qdrant

# 5. (Optional but needed for CLIP-mode image tagging) start the CLIP sidecar
#    — not a pnpm workspace member, so `pnpm dev` never starts it
cd clip-sidecar
python -m venv .venv
source .venv/Scripts/activate   # source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
cd ..

# 6. Make sure the chat WebSocket port matches apps/web's NEXT_PUBLIC_CHAT_URL
export CHAT_PORT=5174

# 7. Run everything else (web on :3000, rag-backend on :8090 via
#    RAG_BACKEND_PORT in its .env, chat-backend on :5174) — apps/rag-backend
#    runs via `ts-node-dev --respawn`, so it auto-restarts on file changes
pnpm dev
```

Building for production:

```bash
pnpm build   # turbo build → `next build` (web), `tsc` (rag-backend, chat-backend)
```

`pnpm lint` and `pnpm type-check` currently only do anything for `apps/web` —
`apps/rag-backend` and `apps/chat-backend` don't define `lint`/`type-check`
scripts, so turbo silently skips them there. To run rag-backend's Vitest suite
(not wired into `turbo.json`), use `pnpm --filter @secondbrain/rag-backend test`
directly.

## Project structure

```text
secondbrain/
├── apps/
│   ├── web/              Next.js app (App Router, Prisma, NextAuth)
│   │   ├── app/           routes: (auth), (dashboard), note/[id], addItem,
│   │   │                  settings, share/[hash], shared, sharing, dm/[friendId],
│   │   │                  and api/ (auth, content, friends, links, messages,
│   │   │                  notes, rag, settings, shared, sharing, tags, upload)
│   │   ├── components/    SideBar, TopBar, Content, ThemeProvider, editor/…
│   │   ├── prisma/        schema.prisma (User, Content, Tag, Friendship,
│   │   │                  Message, NoteShare, Comment, RagDocument, …)
│   │   └── store/         Redux (theme slice)
│   ├── rag-backend/      Express RAG service
│   │   ├── src/lib/       config, groq, embeddings, qdrant, clip-client,
│   │   │                  cloudinary, ocr, video, llamaparse, guardrails, text
│   │   ├── src/services/  indexer.ts — ingestion + askWithRag()
│   │   ├── src/worker/    queue.ts — file-backed async job queue
│   │   └── prisma/        trimmed schema (User/Content stubs + RagDocument)
│   └── chat-backend/     `ws`-based WebSocket server for DMs
├── packages/
│   └── types/            shared TypeScript types (ContentType, Rag* request/
│                          response shapes, ContentItem, …)
├── clip-sidecar/         Python/FastAPI CLIP service (not a pnpm workspace member)
├── prototypes/           historical reference notebook, not maintained
├── docker-compose.yml    qdrant, clip-sidecar, rag-backend services
└── turbo.json            pipeline: build, dev, lint, type-check, db:*, clean
```

## Known Discrepancies & Notes

- Vectors live in Qdrant, not pgvector; the async job queue is a small
  file-backed custom implementation, not BullMQ — there is no Redis dependency;
  and there is no `packages/ai` provider-abstraction package, embeddings call
  Gemini directly.
- `apps/chat-backend` has no `.env.example` and no `.env` loading mechanism at
  all — confirm whether that's intentional before relying on it in a non-dev
  environment (e.g. process manager / container env injection instead of a
  file).
- The CLIP sidecar's `docker-compose.yml` entry sets a `PORT=8001` environment
  variable, but `clip-sidecar/main.py` never reads it — the actual port comes
  from the `uvicorn ... --port 8001` command in the Dockerfile/README
  instructions. Not a functional issue at the current fixed port, but worth
  knowing if that port ever needs to change via env var.
