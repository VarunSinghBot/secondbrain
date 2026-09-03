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
- [Setup & run](#setup--run)

SecondBrain is a multimodal, multi-tenant note-taking app. Capture notes as
text, images, audio, video, or PDFs, tag and share them, and ask
natural-language questions answered from your own content via a
retrieval-augmented generation (RAG) pipeline, with citations back to the
source note — turning a pile of notes into something you can actually query.

## Features

- **Auth** — email/password and Google OAuth via NextAuth v5.
- **5 content types** — article, image, audio, video, document (PDF), each with a dedicated ingestion path.
- **Dashboard** — search by title/body/tag, filter by type, 4 themes, 3 layouts.
- **Tagging** — manual tags plus AI-suggested tags for images (OCR + CLIP + a Groq text call).
- **Sharing** — public share links and direct note-to-friend sharing.
- **Social layer** — friend requests, friendships, direct messages, comments on notes.
- **Multimodal RAG ingestion** — text, audio/video (Whisper), images (captioned/OCR'd/CLIP-embedded), and PDFs (LlamaParse) are all chunked, embedded, and stored per-user in Qdrant.
- **Query rewrite before retrieval** — a fast Groq call cleans up spelling/grammar before embedding; the original question still drives the answer; falls back to the raw query on error or timeout.
- **Grounded question answering** — relevance thresholds and a minimum-score gate prevent ungrounded answers; sources are cited as `[1]`, `[2]`, etc.
- **Per-user isolation** — every Qdrant query/write is scoped by `userId`; a shared secret gates every request between `apps/web` and `apps/rag-backend`.
- **Async ingestion for slow content** — video runs as a background job instead of blocking the request; status is pollable.
- **Reindexing** — a batch endpoint that re-embeds content missing from Qdrant or indexed under a stale embedding model.
- **Admin inspection** — secret-gated endpoints to inspect a user's vectors and reset the Qdrant collections during development.

## Architecture

It's a Turborepo/pnpm monorepo: a Next.js full-stack app for auth, CRUD, and
UI; an Express service for the RAG pipeline; a WebSocket service for direct
messages; and a Python sidecar for CLIP image embeddings. Ingestion chunks and
embeds content into Qdrant per user; queries pass an input guardrail and a
query-rewrite step before retrieval, then a relevance-gated, grounded call to
the Groq LLM. Full pipeline detail is in
[docs/CONFIGURATION.md](docs/CONFIGURATION.md).

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

## Tech stack

- **apps/web** — Next.js 15, React 19, NextAuth 5, Prisma + PostgreSQL, Redux Toolkit, Tailwind CSS.
- **apps/rag-backend** — Express 5, TypeScript, Prisma + PostgreSQL, Groq API, Gemini embeddings, Qdrant.
- **apps/chat-backend** — Node.js WebSocket server (`ws`).
- **clip-sidecar** — Python, FastAPI, PyTorch, Hugging Face Transformers (CLIP).
- **Tooling** — Turborepo, pnpm workspaces, TypeScript.

## Prerequisites

- **Node.js 22+** and **pnpm 11.20.0** (pinned via `packageManager`).
- **PostgreSQL** (plain, no extensions) and **Qdrant** (cloud or self-hosted via `docker-compose.yml`).
- Optional: Python 3.10 (CLIP sidecar), ffmpeg/ffprobe (video ingestion), and API keys for Groq, Gemini, Cloudinary, LlamaParse, OCR.space, and Google OAuth — see [docs/CONFIGURATION.md](docs/CONFIGURATION.md). Redis is not required.

## Setup & run

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Create env files and fill in values
cp apps/web/.env.example apps/web/.env
cp apps/rag-backend/.env.example apps/rag-backend/.env
# apps/rag-backend reads `.env`, not `.env.local`.
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # generates AUTH_SECRET

# 3. Push apps/web's Prisma schema and generate both Prisma clients
pnpm db:push
pnpm db:generate

# 4. Start Qdrant if you're not pointing at a cloud cluster
docker compose up -d qdrant

# 5. (Optional, for CLIP-mode image tagging) start the CLIP sidecar
cd clip-sidecar
python -m venv .venv
source .venv/Scripts/activate   # source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
cd ..

# 6. Match the chat WebSocket port to NEXT_PUBLIC_CHAT_URL
export CHAT_PORT=5174

# 7. Run everything (web :3000, rag-backend :8090, chat-backend :5174)
pnpm dev
```

```bash
pnpm build   # turbo build → next build (web), tsc (rag-backend, chat-backend)
```

`pnpm lint`/`pnpm type-check` only run against `apps/web`; run rag-backend's
tests with `pnpm --filter @secondbrain/rag-backend test`. Full environment
variable reference and configuration detail: [docs/CONFIGURATION.md](docs/CONFIGURATION.md).
