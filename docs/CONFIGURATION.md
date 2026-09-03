# Configuration & Architecture Reference

Full environment-variable reference and RAG pipeline detail for SecondBrain.
See the [root README](../README.md) for a short overview, features, and the
setup steps that reference this file.

## RAG pipeline

Ingestion is per-content-type: text chunks directly; audio/video are
transcribed via Groq Whisper (with ffmpeg frame sampling and captioning for
video); images are captioned and/or OCR'd and CLIP-embedded; PDFs go through
LlamaParse. Chunks (~1200 characters, 150 overlap) are embedded with Gemini
(`gemini-embedding-001`) and written to Qdrant, scoped per user. Video
ingestion runs through a small file-backed job queue
(`apps/rag-backend/src/worker/queue.ts`) instead of inline, with status via
`GET /ingest-async/:jobId`.

At query time, the raw question passes an input guardrail, then a small, fast
Groq call rewrites it for retrieval — spelling/grammar only, falling back to
the raw query on failure. The rewritten query is embedded and searched against
Qdrant; the original question drives answer generation, so responses read
naturally. Results pass a relevance filter, a per-modality cap, and an
overall-score gate before reaching a grounded system prompt and the Groq LLM,
which cites sources as `[1]`, `[2]`, etc.

Postgres tracks indexing state only (the `RagDocument` table) — vectors
themselves live in Qdrant (`rag_text`, `rag_images`), either Qdrant Cloud or
self-hosted via the repo's `docker-compose.yml`.

## Environment variables

### apps/web (`apps/web/.env`, from `apps/web/.env.example`)

| Variable | Purpose | Default |
| :-- | :-- | :-- |
| `DATABASE_URL` | Postgres connection string | required |
| `AUTH_SECRET` | NextAuth session/JWT signing secret (see Setup & run for how to generate) | required |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth login | required |
| `NEXT_PUBLIC_BASE_URL` | Public base URL of the web app | required |
| `NEXT_PUBLIC_CHAT_URL` | Base URL the browser uses to open the chat WebSocket | required |
| `RAG_BACKEND_URL` | Base URL of `apps/rag-backend` | required |
| `RAG_INTERNAL_SECRET` | Shared secret sent as `x-internal-secret` to rag-backend | required, must match rag-backend's value |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Media upload storage | required |

`GROQ_API_KEY` and `OCR_SPACE_API_KEY` are also read by the AI tag-suggestion
route but aren't in `.env.example` — both optional, the feature degrades
without them.

### apps/rag-backend (`apps/rag-backend/.env`, from `apps/rag-backend/.env.example`)

| Variable | Purpose | Default |
| :-- | :-- | :-- |
| `RAG_BACKEND_PORT` | Express server port | `3000` if unset (`.env.example` uses `8090`) |
| `DATABASE_URL` | Postgres connection string (indexing-state tracking only) | required |
| `RAG_INTERNAL_SECRET` | Shared secret required on every request from apps/web | required |
| `GROQ_API_KEY` | Auth for all Groq calls | required |
| `GROQ_LLM_MODEL` | Answer-generation model | `openai/gpt-oss-120b` |
| `GROQ_ASR_MODEL` | Whisper model for audio/video transcription | `whisper-large-v3` |
| `GROQ_CAPTION_MODEL` | Vision model for image/video-frame captioning | `qwen/qwen3.6-27b` |
| `GROQ_QUERY_REWRITE_MODEL` | Model for the pre-retrieval query rewrite | `openai/gpt-oss-20b` |
| `GEMINI_API_KEY` | Auth for Gemini embeddings | required |
| `QDRANT_URL` / `QDRANT_API_KEY` | Vector database connection | required |
| `QDRANT_COLLECTION` | Text/caption vector collection name | `rag_text` |
| `QDRANT_IMAGE_COLLECTION` | Image vector collection name | `rag_images` |
| `QDRANT_VECTOR_SIZE` | Embedding output dimensionality | `768` |
| `CLIP_SIDECAR_URL` | URL of the local CLIP FastAPI service | `http://localhost:8001` |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Media upload storage | required |
| `OCR_SPACE_API_KEY` | OCR text extraction for images | required for image ingestion |
| `LLAMA_CLOUD_API_KEY` | LlamaParse PDF-to-markdown parsing | required for document (PDF) ingestion |
| `ADMIN_SECRET` | Gates `POST /admin/reset-collections` and `GET /admin/inspect` | none — those endpoints return 401 if unset |
| `MIN_RELEVANCE_SCORE` | Relevance floor for text/note hits | `0.5` |
| `CLIP_IMAGE_MIN_SCORE` | Relevance floor for raw CLIP image hits | `0.17` |
| `IMAGE_TAG_SCORE_THRESHOLD` | Floor for image/video-frame caption chunks | `0.52` |
| `IMAGE_FOCUSED_TEXT_SCORE_THRESHOLD` | Stricter text floor for image-focused queries | `0.5` |
| `MIN_OVERALL_SCORE` | Overall relevance gate for `/ask` | `0.45` |
| `CLIP_TAG_THRESHOLD` / `CLIP_TAG_TOP_N` | Zero-shot CLIP tagging floor / max tags (only if `USE_CLIP_ZEROSHOT_TAGGING=true`) | `0.19` / `5` |
| `MAX_VIDEO_FRAMES` | Keyframes sampled per video | `8` |
| `VIDEO_FRAME_DEDUPE_THRESHOLD` | Similarity threshold to drop near-duplicate frames | `0.97` |
| `USE_CLIP_ZEROSHOT_TAGGING` | Use CLIP tagging instead of Groq captioning | `false` |
| `RAG_JOBS_FILE` | Path for the background-job JSON store | `.rag_jobs.json` |

### apps/chat-backend

No `.env.example` exists for this package — it reads one environment variable
directly from `process.env`, with no `.env` file loading:

| Variable | Purpose | Default |
| :-- | :-- | :-- |
| `CHAT_PORT` | WebSocket server port | `8080` in code |

`apps/web`'s `NEXT_PUBLIC_CHAT_URL` defaults to port `5174`, so export
`CHAT_PORT=5174` (or match your `NEXT_PUBLIC_CHAT_URL`) before running `pnpm dev`,
or direct messages won't connect.
