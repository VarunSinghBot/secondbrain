# RAG Backend Test Report — Draft

Date: 2026-08-10

## Scope
- Target: `apps/rag-backend`
- Goals: functional smoke tests, dependency & static scans, secrets review, prepare next steps for full functional and non-functional testing.

## Environment
- OS: Windows
- Node/npm: managed via pnpm (v11)
- Repo: built at `secondbrain/` root with workspace packages

## Actions performed
1. Installed dependencies: `pnpm install` at repo root.
2. TypeScript build: `pnpm --filter @secondbrain/rag-backend build` — fixed one TypeScript error in `src/index.ts` (normalized `req.params.jobId`).
3. Started compiled server: `node dist/index.js` — server reported "SecondBrain RAG backend running on port 8090".
4. Smoke API tests (HTTP):
   - `GET /health` → 200 OK, payload `{ status: "ok", service: "rag-backend" }`.
   - `POST /index` with `{}` → 400 error as expected: `contentId, userId and sourceType are required`.
   - `POST /ask` with `{}` → 400 error as expected: `query and userId are required`.
   - `POST /ingest-async` with sample payload → 202 Accepted and returned a `jobId`. Job persisted to `.rag_jobs.json`.
5. Dependency audit: ran `pnpm audit` (JSON). Summary: vulnerabilities — info=0, low=1, moderate=19, high=25, critical=4. Notable advisories include `brace-expansion`, `js-yaml`, `nanoid`, and several `hono` advisories affecting Prisma dev paths.
6. Secrets/static scan: found placeholder keys in `.env.example` and an actual-looking Qdrant API key inside `src/multimodal_rag_verified.ipynb` (remove/rotate if real).

## Files created / modified during testing
- Modified: `src/index.ts` to validate `jobId` (TypeScript fix).
- Created helper scripts for testing: `scripts/post_ingest.js` and `body.json` (used to POST test payloads).

## Issues & Findings
- Build: a single TypeScript type error (fixed) — `req.params` can be string|string[].
- Runtime: server starts normally but many features require external services (Gemini embeddings/generation, Qdrant) and API keys.
- Secrets: potential secret leaked in notebook — verify whether the Qdrant API key is real; rotate if so.
- Dependencies: multiple high/critical advisories across workspace; these should be triaged and upgraded.

## Recommended next steps (functional testing)
1. Provide access or mock for external services:
   - Qdrant: run locally (Docker) or provide a test cluster and set `QDRANT_URL`/`QDRANT_API_KEY`.
   - Gemini (or other embedding/generation): either provide API key for real testing or implement a mock adapter that returns deterministic embeddings and responses.
2. Add integration tests that:
   - POST an article (text) to `/index` and assert that `indexContent` completes and Qdrant receives upsert calls (or mock assertions).
   - POST a query to `/ask` after indexing and verify relevance/citation mapping (with mock embeddings/search results for deterministic tests).
3. For local, add a `docker-compose.test.yml` that starts Qdrant and a minimal HTTP stub for Gemini endpoints.

## Recommended next steps (non-functional & security)
1. Run `pnpm audit fix` in a branch, then re-run `pnpm audit` and evaluate remaining advisories. Prefer safe upgrades with patch/minor bumps.
2. Search for accidental secrets: remove any real API keys from notebooks or `.env` files and add them to a secrets store.
3. Add CI checks: `pnpm build`, `pnpm audit --audit-level=moderate`, and basic integration smoke tests that run against mocked services.

## Quick commands used
```powershell
cd secondbrain
pnpm install
pnpm --filter @secondbrain/rag-backend build
node apps/rag-backend/dist/index.js
node apps/rag-backend/scripts/post_ingest.js
pnpm audit --json
```

## Where to go from here
  - (A) Implement a mock/golden test harness for embeddings + qdrant and run full functional tests locally.
  - (B) Start dependency remediation with `pnpm audit fix` and create PRs for package upgrades.
  - (C) Produce a full formal report (CSV/Markdown) enumerating each vulnerability and suggested fixes.

Please tell me which action to take next (A, B, or C), or give other instructions.

## Vulnerability Findings (detailed)

- **Summary counts:** info=0, low=1, moderate=19, high=25, critical=4 (workspace-wide from last audit run).
- **Notable packages flagged (examples):** `brace-expansion`, `js-yaml`, `nanoid`, `hono`, `postcss` — these appeared in the audit summary and affect different workspaces (web, packages, dev deps).

### Recommended remediation actions

- **Immediate (high priority):**
   - Rotate any exposed API keys (found in `src/multimodal_rag_verified.ipynb`) and remove them from the repo history. If the key is real, treat it as compromised.
   - Create a branch and run `pnpm audit fix` to apply automatic safe fixes, then run the test suite and smoke tests.

- **Triage & fix:**
   - Run a full `pnpm audit --json > pnpm-audit.json` at the repository root to capture detailed advisories.
   - For each advisory, prefer upgrading the direct dependency that pulls in the vulnerable package. If the vulnerable package is transitive, bump the parent package or add a safe `resolutions`/override as a temporary mitigation.
   - For critical/high vulnerabilities that cannot be upgraded safely, isolate the functionality (feature flag), or replace the package with a maintained alternative.

- **CI and policy:**
   - Add a CI job that fails the build when `pnpm audit` finds vulnerabilities at or above `moderate` (or a stricter threshold you choose).
   - Add pre-commit scanning to block accidental secrets using `git-secrets` or `pre-commit` hooks.

### How I can help (next steps)

- Option C (full formal report): I can produce a per-advisory CSV/Markdown listing that includes: advisory id, module, affected versions, patched versions (if available), severity, paths in workspace, and recommended fix. To do this I need the `pnpm audit --json` output in `pnpm-audit.json` in the repo root. You can either:
   - Run locally: `cd secondbrain && pnpm audit --json > pnpm-audit.json` and then tell me to parse the file, or
   - Allow me to run the audit here (I attempted it but the environment returned an error); if you want me to retry, tell me and I'll re-run the command.

- After I have the audit JSON I will:
   1. Parse the advisories and create `apps/rag-backend/VULNERABILITY_REPORT.md` and `apps/rag-backend/vulnerabilities.csv` with per-advisory remediation guidance.
   2. Open a PR template with recommended package bumps and suggested tests to validate changes.

If you want me to proceed with C now, say `Proceed with C` and either provide the `pnpm-audit.json` file or allow me to rerun the audit here.
