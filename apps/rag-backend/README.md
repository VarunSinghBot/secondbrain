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
                   (Filters hits below minRelevanceScore = 0.35 cutoff)
                                            ↓
                        [ GUARDRAIL 3: Grounded Prompting ]
           (Constructs strict context prompt with [1] citations & CDN links)
                                            ↓
                          [ Groq LLaMA-3 LLM Generation ]
                      (Groq llama-3.3-70b-versatile engine response)
                                            ↓
                       [ GUARDRAIL 4: Grounding Verification ]
              (Ensures no hallucinated fallback when context is missing)
```

---

## Key Features

1. **Groq LLaMA-3 Generation**: High-speed, low-latency grounded question answering powered by `llama-3.3-70b-versatile`.
2. **Groq Whisper ASR**: Automatic speech recognition for audio notes and video tracks using `whisper-large-v3`.
3. **Qdrant Vector Database**: Scalable vector search with strict multi-tenant data isolation (`userId`).
4. **Cloudinary CDN Integration**: Automatic file persistence and CDN URL generation for image, audio, and video items.
5. **4-Tier Guardrails Engine**:
   - **Input Guardrail**: Rejects empty strings, queries > 2000 chars, and adversarial prompt injections.
   - **Context Relevance Guardrail**: Discards search hits below `minRelevanceScore = 0.35`.
   - **System Prompt Guardrail**: Forces strict context bounding, numeric citations (`[1]`, `[2]`), and Cloudinary links.
   - **Grounding Verification**: Ensures ungrounded fallback when relevance criteria fail.

---

## Environment Configuration

Create a `.env` file in `apps/rag-backend/`:

```env
# Server Port
RAG_BACKEND_PORT=8090

# Groq API (ASR & LLM Generation)
GROQ_API_KEY="gsk_..."
GROQ_LLM_MODEL="llama-3.3-70b-versatile"
GROQ_ASR_MODEL="whisper-large-v3"

# Qdrant Vector Database
QDRANT_URL="https://your-cluster.cloud.qdrant.io"
QDRANT_API_KEY="your-qdrant-api-key"
QDRANT_COLLECTION="secondbrain-rag"

# Cloudinary CDN Media Storage
CLOUDINARY_CLOUD_NAME="your-cloud-name"
CLOUDINARY_API_KEY="your-api-key"
CLOUDINARY_API_SECRET="your-api-secret"

# Optional Services & Guardrails
MIN_RELEVANCE_SCORE=0.35
OCR_SPACE_API_KEY="your-ocr-space-api-key"
LLAMA_CLOUD_API_KEY="your-llama-cloud-api-key"
GEMINI_API_KEY="your-gemini-api-key"
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
