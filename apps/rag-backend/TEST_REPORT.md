# RAG Backend — Current State

A snapshot of `apps/rag-backend`'s verified state as of the commits below. This is not a log of how the system got here — see `git log` for that. It's what's actually true about the system right now, backed by evidence, not description.

Reference commits: `02107e1`, `b3fa222`, `6c72771`, `23e517b`, `a2575f7` (plus an uncommitted LlamaParse request-shape fix and PDF verification, pending review).

## Dependency audit

`pnpm audit`, run live against the current lockfile: **0 vulnerabilities** (critical/high/moderate/low all zero). `browserslist` and `mysql2` were the last two high-severity findings (transitive, via `autoprefixer` and `prisma`'s bundled multi-driver support respectively — neither a direct dependency, neither reachable at runtime by this app), pinned to patched versions via `pnpm-workspace.yaml`'s `overrides` block.

## Content-type verification

All five ingestible content types have been verified against the real pipeline — real API calls, real external services, no mocks.

**Text** — the baseline path (chunk → `gemini-embedding-001` embed → Qdrant `rag_text`). Used throughout as the control against which the other four modalities were compared.

**Image** — CLIP's fixed-vocabulary zero-shot tagging (`clip-sidecar`'s `TAG_CANDIDATES`) was replaced with real free-text captioning via a vision-capable Groq model (`qwen/qwen3.6-27b`, `config.groqCaptionModel`). The old approach ranked wrong tags above correct ones in a tight score band on real photos (confirmed: a real mountain/wildflower photo's own candidate scores clustered `nature 0.244 / landscape 0.2387 / mountain 0.2271` against `outdoor activity 0.2199 / science 0.2106` — a ~0.007 margin, not a reliable signal). The new path produces real descriptions, e.g. on that same photo: *"A sunlit hillside is covered in dense patches of purple lupines and bright yellow flowers, with rolling green hills and distant mountains under a blue sky with wispy clouds."* — correctly cited in a real end-to-end ask. CLIP's 512-dim embedding itself is untouched; the zero-shot path still exists behind `USE_CLIP_ZEROSHOT_TAGGING` (off by default) for rollback. Caveat: `qwen/qwen3.6-27b` is a reasoning model — callers must pass `reasoning_effort: "none"` or it spends its entire token budget on a hidden `<think>` block and returns empty content.

**Audio** — real Whisper transcription (`whisper-large-v3` via Groq), verified against a real speech recording, not a mock transcript. A voice-memo test note ("Remember to call the dentist on Thursday to reschedule the cleaning appointment...") was transcribed exactly and correctly answered/cited via `/ask`.

**Video** — real end-to-end: ffmpeg frame extraction, CLIP embedding + dedup, Groq per-frame captioning, Whisper transcription of the audio track. Verified against a real silent video transitioning between two distinct real photos: the log shows genuine dedup at work (`"skipped 6 of 8 sampled frame(s) as near-duplicates"`, keeping exactly the 2 visually distinct frames), each with its own real Groq caption (*"wildflower meadow with purple lupines..."* / *"three stacked photographs of a coastal scene..."*), and the resulting answer correctly described both scenes with real timestamped citations (`video_frame` at 0:00 and 0:03, scores 0.656/0.652).

**PDF / document** — real LlamaParse extraction, verified against a real generated PDF. Extracted text (via LlamaParse, stored verbatim in `rag_text`):
> *"# Northwind Ridge Observatory - Site Survey [...] the proposed Northwind Ridge Observatory telescope dome has a recommended aperture of 1.4 meters. The site elevation is 2,930 meters above sea level [...] The lead site engineer is listed as Dr. Elena Vasquez, and the internal project tracking code for this survey is RIDGE-OBS-4471."*

Asked *"What is the recommended telescope dome aperture and site elevation for the Northwind Ridge Observatory, and what is the project tracking code?"* via the real `/ask` endpoint, real answer:
> *"The Northwind Ridge Observatory is recommended to have a telescope dome with a 1.4‑meter aperture, and the site sits at an elevation of about 2,930 meters above sea level. The internal project tracking code for this survey is RIDGE‑OBS‑4471."*

Correctly cited (`sourceType: "document"`, `modality: "pdf"`, score 0.7162). Getting here required two independent fixes: Cloudinary was uploading PDFs as `resource_type: "auto"` → classified as `"image"` → blocked from unauthenticated delivery by default (401); and LlamaParse's job-creation endpoint rejects an `expand` field in the request body (`422 extra_forbidden`) that earlier code was sending — both fixed in code, the Cloudinary account's own PDF/ZIP delivery restriction was a separate, non-code fix on the account side.

## Relevance thresholds

`config.ts`'s five retrieval-relevance values were empirically retuned against real `gemini-embedding-001` and CLIP cosine-similarity distributions — a real corpus across all five content types, queried with real questions (clear per-modality, deliberately unanswerable, cross-topic/ambiguous), scoring every real hit. Current values:

| Config key | Value | What it gates |
|---|---|---|
| `minRelevanceScore` | 0.5 | Gemini text-collection hits (real content: article/audio/video/document) |
| `clipImageMinScore` | 0.17 | Raw CLIP image-collection (`rag_images`) hits — **not** the same scale as the above; sharing one threshold across both used to silently zero out every CLIP hit once raised high enough to matter for text |
| `imageTagScoreThreshold` | 0.52 | Image/video-frame caption chunks living in the text collection |
| `imageFocusedTextScoreThreshold` | 0.5 | Text hits, when a query is detected as image-focused |
| `minOverallScore` | 0.45 | Overall gate — below this, nothing is relevant enough to answer at all |

These are not guesses. Full reasoning and the underlying score data live as comments directly above each value in `config.ts` — read those before changing any of them.

Verified separately against real PDF content (not part of the original retune corpus): raw scores of **0.634–0.716** across four real questions against a real PDF chunk — squarely inside the same band real correct hits scored in the original retune (0.576–0.778). The thresholds hold for document-modality content; no retuning needed there.

## Known open issues

Stated plainly, not glossed over:

1. **Retrieval-ranking decoy case.** A query about a specific real photo ("What does my mountain photo show?") was refused even though the correct caption (score 0.646) was retrieved and in context — a video frame captioned "a rocky coastal landscape" narrowly outranked it (0.672) as an unrelated decoy, and the LLM's own grounding caution declined rather than choose between two candidate photos. The correct item cleared every threshold; this is a ranking/decoy problem, not a threshold miscalibration, and it isn't fixed.
2. **LLM grounding-refusal despite correct context.** Found during PDF verification: a question about the PDF's seismic recommendation scored 0.667 (well above every threshold) and the correct chunk was passed to the LLM — which still declined to answer. Distinct from issue 1 (no decoy competing here); this is the model's own answer-generation judgment declining on a chunk it had every reason to use. Not understood or fixed, just observed.
3. **`imageFocusedTextScoreThreshold` gates an effectively dead branch.** CLIP's cross-modal cosine scale (~0.15–0.25) never exceeds Gemini's same-modality scale (~0.44–0.78) in practice — `topImageScore > topTextScore` was false in every real test query run against this system, including image-focused ones. The "symmetric relevance balancing" this threshold is meant to enable is currently unreachable code by design, not by bug. Fixing it means comparing something other than raw scores across the two embedding spaces (e.g. rank instead of magnitude) — not done.
4. **Cosine-threshold gating has a hard ceiling on precision.** Gemini cosine scores for any two natural-language passages cluster densely (0.44–0.78) regardless of real topical relevance — a deliberately unanswerable test query still scored 0.60+ against completely unrelated content. The thresholds above are a coarse noise filter, not a precision guarantee; real relevance judgment leans on the LLM's own grounded-prompt behavior as a second line of defense, which per issue 2 isn't perfectly reliable either.

## Internal auth model

Every route apps/web calls on rag-backend requires the `x-internal-secret` header to match `RAG_INTERNAL_SECRET` (`requireInternalSecret` middleware, `index.ts`) — **8 routes**: `/index`, `/reindex`, `/ask`, `/verify`, `/delete`, `/tag-image`, `/ingest-async` (POST), `/ingest-async/:jobId` (GET). Fail-closed: a missing/unset `RAG_INTERNAL_SECRET` on the server denies every request rather than allowing them through. `/admin/reset-collections` and `/admin/inspect` are gated separately by `x-admin-secret` / `ADMIN_SECRET` (same fail-closed pattern, kept as a distinct secret so routine traffic can't be weakened by reusing the key that guards genuinely destructive operations). `/health` is intentionally open, no auth.

This is presence-of-secret auth, not identity auth — rag-backend has no concept of a real user session; it trusts whatever `userId` is in the request body once the shared secret checks out, relying on apps/web having already authenticated the actual person and on network isolation keeping this service unreachable from outside. Fine as long as that isolation holds; worth knowing if this service is ever exposed directly.

## Original prototype

The original Colab/Jupyter prototype that predates this pipeline has moved to `prototypes/multimodal_rag_verified.ipynb` at the repo root — historical reference only, not executed or maintained. See `prototypes/README.md`.
