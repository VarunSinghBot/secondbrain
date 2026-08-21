# @secondbrain/rag-backend

> High-Performance Multimodal RAG (Retrieval-Augmented Generation) Engine powered by **Groq LLaMA-3**, **Groq Whisper**, **Qdrant Vector Database**, **Cloudinary CDN**, and a **4-Tier Guardrails Framework**.

---

## Architecture & System Flow

```
                                  USER CONTENT INGESTION
          (Text / Shared Note / Image / Audio / Video / PDF Document)
                                            ↓
                                 [ Cloudinary CDN Upload ]
                      (Generates persistent, secure CDN media URLs)
                                            ↓
                                  [ Multimodal Extraction ]
      • Audio / Video → Groq Whisper ASR (whisper-large-v3)
      • Image         → OCR.space Text & Tag Extraction
      • Documents     → LlamaParse Markdown Extraction
                                            ↓
                                 [ Text Chunking & Embedding ]
                      (Overlapping word-chunks → Vector Embeddings)
                                            ↓
                                [ Qdrant Vector Database ]
                      (Isolated storage with mandatory userId filter)
                                            ↓
-----------------------------------------------------------------------------------
                                   QUERY & RETRIEVAL
                                            ↓
                             [ GUARDRAIL 1: Input Sanitization ]
                (Input length limits, prompt injection & jailbreak filters)
                                            ↓
                              [ Qdrant Vector Search ]
                      (Top-K similarity search scoped to userId)
                                            ↓
                           [ GUARDRAIL 2: Relevance Cutoff ]
                (Filters hits below the configured relevance thresholds —
                         see Environment Configuration below)
                                            ↓
                        [ GUARDRAIL 3: Grounded Prompting ]
           (Constructs strict context prompt with [1] citations & CDN links)
                                            ↓
                          [ Groq LLM Generation ]
                      (Groq openai/gpt-oss-120b engine response)
                                            ↓
                       [ GUARDRAIL 4: Grounding Verification ]
              (Ensures no hallucinated fallback when context is missing)
```

---

## Key Features

1. **Groq LLM Generation**: High-speed, low-latency grounded question answering powered by `openai/gpt-oss-120b` (configurable via `GROQ_LLM_MODEL`).
2. **Groq Whisper ASR**: Automatic speech recognition for audio notes and video tracks using `whisper-large-v3`.
3. **Qdrant Vector Database**: Scalable vector search with strict multi-tenant data isolation (`userId`).
4. **Cloudinary CDN Integration**: Automatic file persistence and CDN URL generation for image, audio, and video items.
5. **4-Tier Guardrails Engine**:
   - **Input Guardrail**: Rejects empty strings, queries > 2000 chars, and adversarial prompt injections.
   - **Context Relevance Guardrail**: Discards search hits below the configured relevance thresholds (`MIN_RELEVANCE_SCORE`, `IMAGE_TAG_SCORE_THRESHOLD`, `IMAGE_FOCUSED_TEXT_SCORE_THRESHOLD`, `MIN_OVERALL_SCORE` — see Environment Configuration).
   - **System Prompt Guardrail**: Forces strict context bounding, numeric citations (`[1]`, `[2]`), and Cloudinary links.
   - **Grounding Verification**: Ensures ungrounded fallback when relevance criteria fail.

---

## Environment Configuration

Create a `.env` file in `apps/rag-backend/`:

This list matches `.env.example` exactly — copy that file to `.env` and fill
in real values rather than retyping it here.

```env
# Server
RAG_BACKEND_PORT=8090

# Postgres (Prisma — RagDocument indexing-state tracking, see Reindexing below)
DATABASE_URL="postgresql://user:password@localhost:5432/secondbrain"

# Groq API (LLM answer generation & Whisper ASR)
GROQ_API_KEY="your-groq-api-key"
GROQ_LLM_MODEL="openai/gpt-oss-120b"
GROQ_ASR_MODEL="whisper-large-v3"

# Gemini API (embeddings — gemini-embedding-001, fixed, not env-overridable)
GEMINI_API_KEY="your-gemini-api-key"

# Qdrant Vector Database
QDRANT_URL="https://your-cluster.qdrant.tech"
QDRANT_API_KEY="your-qdrant-api-key"
QDRANT_COLLECTION="rag_text"
QDRANT_IMAGE_COLLECTION="rag_images"
QDRANT_VECTOR_SIZE=768

# CLIP sidecar — local service, see "Required Running Services" above
CLIP_SIDECAR_URL="http://localhost:8001"

# Cloudinary CDN Media Storage
CLOUDINARY_CLOUD_NAME="your-cloudinary-cloud-name"
CLOUDINARY_API_KEY="your-cloudinary-api-key"
CLOUDINARY_API_SECRET="your-cloudinary-api-secret"

# Optional Services
OCR_SPACE_API_KEY="your-ocr-space-api-key"
LLAMA_CLOUD_API_KEY="your-llama-cloud-api-key"

# Admin endpoints (POST /admin/reset-collections, GET /admin/inspect) —
# sent as the x-admin-secret header
ADMIN_SECRET="your-admin-secret"

# Retrieval Relevance Guardrails
# Carried over unchanged from the values previously hardcoded/documented —
# NOT re-tuned. They were set against the old hash-based fallback embedding;
# cosine similarity distributions differ meaningfully between that and real
# Gemini embeddings, so these need empirical re-tuning now that retrieval
# runs on real embeddings. That re-tuning has not happened yet.
MIN_RELEVANCE_SCORE=0.2
IMAGE_TAG_SCORE_THRESHOLD=0.35
IMAGE_FOCUSED_TEXT_SCORE_THRESHOLD=0.35
MIN_OVERALL_SCORE=0.21
```

---

## Required Running Services

Besides the cloud services configured above (Qdrant, Postgres, Cloudinary, Groq,
Gemini), one service has to be running **locally** before you start rag-backend:

- **CLIP sidecar** (`../../clip-sidecar`) — a separate Python/FastAPI service
  that generates CLIP image embeddings and tags for image ingestion in
  `clip` mode (`POST /index` with an image, `mode: "clip"`). rag-backend
  talks to it over HTTP at `CLIP_SIDECAR_URL` (default
  `http://localhost:8001`); it is **not** started automatically by `pnpm dev`.
  Without it running, image uploads in `clip` mode fail with a `503` naming
  the sidecar — OCR-mode image ingestion and all other content types are
  unaffected.

  Run it directly:
  ```bash
  cd clip-sidecar
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8001
  ```
  Or via the repo's `docker-compose.yml`, which starts Qdrant, the CLIP
  sidecar, and rag-backend together:
  ```bash
  docker compose up clip-sidecar
  ```

- **ffmpeg / ffprobe** — required on the machine running rag-backend itself
  (not a separate service) for video ingestion: `ffmpeg` extracts the audio
  track and samples keyframes, `ffprobe` reads a video's duration to time
  those keyframes. Without both on `PATH`, video uploads fail. Not needed
  for any other content type.

  ```bash
  # macOS
  brew install ffmpeg

  # Ubuntu/Debian
  sudo apt-get update && sudo apt-get install -y ffmpeg
  ```

---

## API Endpoints

### 1. Health Check
`GET /health`

**Response:**
```json
{
  "status": "ok",
  "service": "rag-backend"
}
```

---

### 2. Synchronous Ingestion
`POST /index`

**Request Body:**
```json
{
  "userId": "user-123",
  "contentId": "note-456",
  "sourceType": "article",
  "sourceName": "AI Memory Architecture",
  "text": "Retrieval-Augmented Generation combines retrieval with generative models."
}
```

**Response (201 Created):**
```json
{
  "message": "Indexed",
  "contentId": "note-456",
  "userId": "user-123",
  "chunksIndexed": 1,
  "chunkIds": ["uuid-point-id"],
  "chunks": [
    {
      "qdrantPointId": "uuid-point-id",
      "chunkIndex": 1,
      "text": "Retrieval-Augmented Generation combines...",
      "tokenCount": 8
    }
  ]
}
```

---

### 3. Guardrailed Question Answering
`POST /ask`

**Request Body:**
```json
{
  "userId": "user-123",
  "query": "What does RAG combine?",
  "topK": 5
}
```

**Response (200 OK):**
```json
{
  "answer": "Retrieval-Augmented Generation (RAG) combines a retrieval system with a generative language model [1].",
  "citations": [
    {
      "contentId": "note-456",
      "title": "AI Memory Architecture",
      "sourceType": "article",
      "sourceUrl": null,
      "chunkIndex": 1,
      "score": 0.8842
    }
  ]
}
```

---

### 4. Asynchronous Queue Ingestion
`POST /ingest-async`

**Request Body:**
```json
{
  "userId": "user-123",
  "contentId": "audio-789",
  "sourceType": "audio",
  "sourceUrl": "https://example.com/podcast.mp3"
}
```

**Response (202 Accepted):**
```json
{
  "jobId": "job-uuid",
  "status": "queued"
}
```

### Check Async Job Status
`GET /ingest-async/:jobId`

---

## Directory Structure

```
apps/rag-backend/
├── src/
│   ├── index.ts               # Express HTTP server & route handlers
│   ├── lib/
│   │   ├── config.ts          # Centralized env config & sanitization
│   │   ├── groq.ts            # Groq Whisper ASR & LLaMA-3 Chat API
│   │   ├── guardrails.ts      # 4-Tier Guardrails engine
│   │   ├── qdrant.ts          # Qdrant client & vector operations
│   │   ├── cloudinary.ts      # Cloudinary CDN media upload helper
│   │   ├── gemini.ts          # Embedding fallback generator
│   │   ├── ocr.ts             # OCR.space integration
│   │   ├── video.ts           # FFmpeg audio & frame extractor
│   │   └── llamaparse.ts      # Document parser integration
│   ├── services/
│   │   └── indexer.ts         # Ingestion pipeline & Guardrailed RAG ask flow
│   ├── worker/
│   │   └── queue.ts           # Background job queue runner
│   └── test-rag-suite.ts      # End-to-end automated test suite
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Testing & Verification Suite

Run the full automated test suite (Unit, Functional, Security, SLA Performance):

```bash
npm run build
node dist/test-rag-suite.js
```

**Test Suite Coverage:**
- **Unit Tests**: Query validation, prompt injection filter, relevance cutoff, grounding fallback.
- **Functional Tests**: Live Qdrant vector database search, Groq LLaMA-3 generation, document ingestion.
- **Security Tests**: Tenant multi-user isolation verification.
- **Performance SLA**: Response time benchmarking (< 5000ms SLA target).
