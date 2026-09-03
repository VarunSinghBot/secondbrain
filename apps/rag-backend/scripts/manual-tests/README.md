# Manual test scripts

Ad-hoc, hand-run scripts from earlier development — not wired into any
`package.json` script, not part of the Vitest suite (`src/__tests__/`,
`src/lib/*.test.ts`, `src/worker/queue.test.ts`, run via `pnpm test`), and not
type-checked as part of the build (they live outside `tsconfig.json`'s
`src/**/*` include).

**They hit real external services** — Groq, Qdrant, Gemini, and/or
Cloudinary, depending on the script — using whatever credentials are in your
`.env`. Running them costs real API calls and writes real data into your
configured Qdrant collections/Postgres. None of them are safe to run against
a shared or production environment.

| Script | What it exercises |
| :-- | :-- |
| `test-rag-suite.ts` | Guardrails (query validation, relevance, grounding) plus a live `indexContent`/`askWithRag` round trip. |
| `test-comprehensive-suite.ts` | Broadest coverage — ingestion, retrieval, reindexing, deletion, guardrails — against live Qdrant/Postgres. |
| `test-all-modalities-suite.ts` | `indexContent`/`askWithRag` across each content modality in turn. |
| `test-rag-smoke.ts` | Minimal smoke test of the embed → Qdrant → Groq answer path. |
| `test-http-endpoints.ts` | Exercises the running server's HTTP routes directly (`http://localhost:$RAG_BACKEND_PORT`) — start `pnpm dev` first. |
| `test-live-http.ts` | Spins up its own throwaway Express server on port 8099 and drives it end-to-end. |

Run any of them with `ts-node` or `ts-node-dev` from `apps/rag-backend`, e.g.:

```bash
npx ts-node-dev --transpile-only scripts/manual-tests/test-rag-smoke.ts
```

They overlap with each other significantly (several independently reimplement
"index some content, then ask a question about it"); they were kept rather
than deleted because none of them are actually superseded by the Vitest
suite, which only covers `guardrails.ts`, `text.ts`, `clip-client.ts`'s
error path, and the job queue in isolation — none of it exercises live
ingestion or retrieval end-to-end the way these do.
