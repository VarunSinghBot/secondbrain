# RAG Backend

This service provides ingestion, retrieval and RAG answer endpoints for the SecondBrain project.

Available endpoints

- `GET /health` — healthcheck
- `POST /index` — synchronous indexing (body: `RagIndexRequest`)
- `POST /ingest-async` — enqueue an ingestion job (body: `RagIndexRequest`) → returns `jobId`
- `GET /ingest-async/:jobId` — check job status
- `POST /ask` — ask a question (body: `RagAskRequest`)

Run (development):

```bash
cd apps/rag-backend
pnpm install
pnpm dev
```

Environment

Copy `.env.example` to `.env` and set provider keys:

- `GROQ_API_KEY`, `GEMINI_API_KEY` (LLM/embedding)
- `QDRANT_URL`, `QDRANT_API_KEY`
- `OCR_SPACE_API_KEY` (optional)

Quick ingestion (curl)

```bash
curl -X POST http://localhost:8090/ingest-async \
  -H 'Content-Type: application/json' \
  -d '{"contentId":"example-1","userId":"user-1","sourceType":"article","text":"Hello world"}'
```

Check job status:

```bash
curl http://localhost:8090/ingest-async/<JOB_ID>
```

Ask a question:

```bash
curl -X POST http://localhost:8090/ask \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user-1","query":"What is Retrieval-Augmented Generation?"}'
```

Test & Rollout Checklist

1. Configure secrets in `.env` (do NOT commit keys).
2. Start a staging Qdrant instance and set `QDRANT_URL` and `QDRANT_API_KEY`.
3. Start the service: `pnpm dev`.
4. Run ingestion for each modality (text, small image, small audio, short video). Verify jobs complete via `/ingest-async/:jobId`.
5. Use `/ask` to verify the answer is grounded; check returned `citations` contain `contentId` and `sourceUrl`.
6. Run the notebook's verification cells locally (optional) to validate embedding + retrieval parity.
7. Add monitoring for Qdrant point counts and Groq/Gemini usage; set alerts for anomalous costs.
8. Add automated E2E tests in CI that run one ingestion and an `/ask` query against a mocked or staging LLM.

Security & Ops

- Rotate API keys using your secrets manager and keep `.env` out of VCS.
- Add rate-limits and auth to ingestion and ask endpoints before public exposure.
- Implement purge/delete endpoints to comply with user data deletion requests.
