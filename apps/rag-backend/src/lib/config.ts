import dotenv from "dotenv"

dotenv.config()

function cleanEnv(val: string | undefined, defaultVal = ""): string {
  if (!val) return defaultVal
  let trimmed = val.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    trimmed = trimmed.slice(1, -1).trim()
  }
  return trimmed || defaultVal
}

function getEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key]
  for (const k of Object.keys(process.env)) {
    if (k.trim() === key) {
      return process.env[k]
    }
  }
  return undefined
}

export const config = {
  port: Number(getEnv("RAG_BACKEND_PORT") ?? 3000),
  databaseUrl: cleanEnv(getEnv("DATABASE_URL")),
  groqApiKey: cleanEnv(getEnv("GROQ_API_KEY")),
  geminiApiKey: cleanEnv(getEnv("GEMINI_API_KEY")),
  ocrSpaceApiKey: cleanEnv(getEnv("OCR_SPACE_API_KEY")),
  llamaCloudApiKey: cleanEnv(getEnv("LLAMA_CLOUD_API_KEY")),
  qdrantUrl: cleanEnv(getEnv("QDRANT_URL")),
  qdrantApiKey: cleanEnv(getEnv("QDRANT_API_KEY")),
  qdrantCollection: cleanEnv(getEnv("QDRANT_COLLECTION"), "rag_text"),
  qdrantImageCollection: cleanEnv(getEnv("QDRANT_IMAGE_COLLECTION"), "rag_images"),
  clipSidecarUrl: cleanEnv(getEnv("CLIP_SIDECAR_URL"), "http://localhost:8001"),
  // Off by default: searchSimilar/searchSimilarImages (qdrant.ts) log every
  // retrieved hit's modality/score/text-preview on every request when this
  // is true — real user note content, so it must stay opt-in, not print
  // unconditionally in production.
  debugRetrievalLogging: (getEnv("DEBUG_RETRIEVAL_LOGGING") ?? "false").trim().toLowerCase() === "true",
  // Fixed, not env-overridable: Qdrant vectors and Gemini's outputDimensionality
  // are tied to this exact model, so swapping it requires a deliberate migration.
  embeddingModel: "gemini-embedding-001" as const,
  // llama-3.3-70b-versatile was retired from Groq's catalog (confirmed via a
  // live /openai/v1/models check — no llama chat model remains available;
  // only whisper, gpt-oss, qwen, and groq/compound are offered now).
  // TODO: answerModel and groqLlmModel both derive from GROQ_LLM_MODEL and
  // are always identical — one of the two fields is redundant.
  answerModel: cleanEnv(getEnv("GROQ_LLM_MODEL"), "openai/gpt-oss-120b"),
  groqLlmModel: cleanEnv(getEnv("GROQ_LLM_MODEL"), "openai/gpt-oss-120b"),
  groqAsrModel: cleanEnv(getEnv("GROQ_ASR_MODEL"), "whisper-large-v3"),
  // Vision-capable Groq model used to caption images/video frames (image.ts,
  // video.ts). Confirmed live against Groq's /v1/models catalog and tested
  // end-to-end with a real image — it's a reasoning model, so callers MUST
  // pass reasoning_effort: "none" or it burns the whole token budget on a
  // hidden <think> block and returns empty content (confirmed: with
  // reasoning enabled and max_tokens=300, 300/300 tokens went to reasoning,
  // content was "").
  groqCaptionModel: cleanEnv(getEnv("GROQ_CAPTION_MODEL"), "qwen/qwen3.6-27b"),
  // Small/fast Groq model used only to reformulate the raw user query before
  // embedding/retrieval (see rewriteQueryForRetrieval, groq.ts) — this runs
  // on the critical path of every askWithRag() call, so it's deliberately
  // the smallest general text model in Groq's current catalog rather than
  // groqLlmModel. Confirmed live: gpt-oss-20b requires reasoning_effort
  // "low" (unlike qwen3.6-27b, it rejects "none" outright), and "low" still
  // returns in ~0.4-0.6s with the actual rewritten text, not just reasoning.
  groqQueryRewriteModel: cleanEnv(getEnv("GROQ_QUERY_REWRITE_MODEL"), "openai/gpt-oss-20b"),
  // Was true (the only option) before real image captioning existed.
  // CLIP's forced-choice zero-shot tagging (clip-sidecar's fixed
  // TAG_CANDIDATES vocabulary) produces wrong tags outranking correct ones
  // in a tight score band — confirmed across multiple real photos (a
  // mountain photo's own "mountain" tag lost to "ocean"/"boat"). Not a
  // threshold problem — no amount of retuning clipTagThreshold/clipTagTopN
  // fixes a ranking failure. Default is now false: image.ts/video.ts caption
  // via Groq (groqCaptionModel) instead. clip-sidecar's /tag-image endpoint
  // and clip-client.ts's tagImage() are left in place, not deleted, and this
  // flag switches back to them if a closed-vocabulary tag list is ever
  // needed again — CLIP's 512-dim image embedding itself is unaffected
  // either way, this only controls the tagging/captioning step.
  useClipZeroShotTagging: (getEnv("USE_CLIP_ZEROSHOT_TAGGING") ?? "false").trim().toLowerCase() === "true",
  cloudinaryCloudName: cleanEnv(getEnv("CLOUDINARY_CLOUD_NAME")),
  cloudinaryApiKey: cleanEnv(getEnv("CLOUDINARY_API_KEY")),
  cloudinaryApiSecret: cleanEnv(getEnv("CLOUDINARY_API_SECRET")),
  qdrantVectorSize: Number(getEnv("QDRANT_VECTOR_SIZE") ?? 768),

  // ─── RAG retrieval relevance thresholds (askWithRag, services/indexer.ts) ───
  // Re-tuned empirically (Task 3) against real gemini-embedding-001 and CLIP
  // cosine-similarity distributions — a 6-item corpus across all modalities
  // (2 text notes, 1 document-modality note, 1 real photo, 1 real
  // Whisper-transcribed audio note, 1 real video with CLIP-captioned frames)
  // queried with 10 real questions (clear per-modality, deliberately
  // unanswerable, and cross-topic/ambiguous), recording raw unfiltered
  // scores for every hit. Two findings shaped these numbers:
  //
  // 1. gemini-embedding-001 cosine scores for ANY two natural-language
  //    passages cluster densely in a 0.44–0.78 band regardless of real
  //    topical relevance — a wildly irrelevant query ("weather in Paris")
  //    still scored 0.48–0.63 against every unrelated note. There is no
  //    single cosine cutoff that cleanly separates correct from incorrect
  //    hits (observed: correct hits 0.5757–0.7775, incorrect hits up to
  //    0.6849 — the ranges overlap). These thresholds are therefore a
  //    coarse pre-filter to cut the worst noise before it reaches the LLM,
  //    not a precision guarantee — final relevance judgment still leans on
  //    the grounded system prompt instructing the LLM to only cite what's
  //    actually relevant.
  // 2. CLIP cross-modal (text query vs image) cosine scores live on a much
  //    lower, non-comparable scale (observed: 0.15–0.25) than
  //    gemini-embedding-001's same-modality scale above. minRelevanceScore
  //    was previously also the default floor applied to raw CLIP
  //    rag_images hits (validateContextRelevance's default parameter,
  //    indexer.ts) — sharing one threshold across both was structurally
  //    broken: a value high enough to filter Gemini-scale noise (~0.5)
  //    would silently zero out every CLIP image hit, correct ones
  //    included, since even the best real photo→matching-query score
  //    observed was 0.2388. Split into a separate clipImageMinScore below
  //    so retuning one doesn't break the other.
  //
  // Full score data: see the Task 3 write-up (not committed — ask if you
  // want the raw log preserved somewhere).

  // Floor applied to note/text hits (real content: article/audio/video/
  // document modalities) in the Gemini text collection. Raised from 0.2
  // (which filtered nothing — every observed hit, relevant or not, scored
  // above it) to sit just below the lowest real correct-hit score observed
  // (0.5757), so it drops the bottom of the noise range without excluding
  // a genuine weak match.
  minRelevanceScore: Number(getEnv("MIN_RELEVANCE_SCORE") ?? 0.5),

  // Floor applied specifically to raw CLIP image-collection (rag_images)
  // hits — decoupled from minRelevanceScore (see note above) because CLIP's
  // cross-modal cosine scale is much lower and not comparable to Gemini's.
  // Set just below the lowest real correct CLIP hit observed (0.1691) to
  // preserve recall; at this corpus size correct (0.1691–0.2388) and
  // incorrect (0.1548–0.2463) CLIP scores still overlap almost entirely, so
  // this is intentionally permissive — same "coarse pre-filter, let the LLM
  // judge the rest" reasoning as minRelevanceScore. New in Task 3 — there
  // was no separate env var for this before.
  clipImageMinScore: Number(getEnv("CLIP_IMAGE_MIN_SCORE") ?? 0.17),

  // Image-tag description chunks live in the text collection with
  // modality="image"/"video_frame". Previously assumed to score *lower*
  // than real notes (hence "own lower floor" in the old comment here) —
  // that assumption predates Task 1's switch from terse CLIP tag lists to
  // full Groq-generated sentence captions, which embed just as "generically
  // high" as any other text (observed range 0.44–0.67, overlapping real
  // notes' range, not below it). Raised from 0.35 to sit just below the
  // lowest real correct video-frame-caption score observed (0.5498).
  imageTagScoreThreshold: Number(getEnv("IMAGE_TAG_SCORE_THRESHOLD") ?? 0.52),

  // Symmetric relevance balancing: when the top CLIP image score beats the
  // top text score, the query looks image-focused, so text hits are held to
  // this stricter floor instead of minRelevanceScore. Task 3 finding: given
  // CLIP's much lower scale (above), topImageScore beat topTextScore in
  // ZERO of 10 real test queries, including image-focused ones ("What does
  // my mountain photo show?" scored topText=0.6457 vs topImage=0.2388) — as
  // designed, this branch is effectively unreachable with the current
  // embedding models, so its exact value has little practical effect right
  // now. Left aligned with minRelevanceScore rather than tuned separately;
  // fixing the comparison itself (e.g. normalizing scores before comparing,
  // or comparing rank instead of raw score) is a real design gap but out of
  // scope for a threshold retune.
  imageFocusedTextScoreThreshold: Number(getEnv("IMAGE_FOCUSED_TEXT_SCORE_THRESHOLD") ?? 0.5),

  // Overall gate: if every retrieved hit (text + image) scores below this,
  // nothing is truly relevant to the query and askWithRag short-circuits
  // with the "no sufficient context" fallback instead of calling the LLM.
  // Was hardcoded as MIN_OVERALL_SCORE in indexer.ts. Task 3 finding: this
  // gate is NOT a reliable answerable/unanswerable discriminator at any
  // value — both deliberately unanswerable test queries ("grandmother's
  // cookie recipe", "weather in Paris", nothing relevant indexed) still hit
  // a best score of 0.60–0.63 from Gemini's generic same-domain similarity,
  // while some genuinely correct-but-weak matches scored as low as 0.5757.
  // Those ranges overlap, so no single number here can separate them —
  // raising this only catches the most degenerate zero-signal case (e.g. a
  // brand-new empty account), not "technically indexed, but not what was
  // asked." Meaningfully fixing that would need a different mechanism
  // entirely (e.g. an LLM sufficiency check), which is out of scope for a
  // threshold retune — flagging as a real limitation, not solving it here.
  minOverallScore: Number(getEnv("MIN_OVERALL_SCORE") ?? 0.45),

  // ─── CLIP zero-shot image/frame tagging (clip-client.ts, clip-sidecar/main.py) ───
  // Same names/defaults as clip-sidecar's own env vars, since the two need to
  // agree — but they're separate processes with separate environments, so
  // both must be set if overriding. Calibrated against real score
  // distributions from an indexed photo and an indexed cartoon video frame:
  // with only 47 candidate tags, top_k was doing all the real filtering
  // (threshold 0.18 sits below nearly every candidate's score), so capping to
  // the top 5 is what actually removes the long tail of unrelated tags.
  clipTagThreshold: Number(getEnv("CLIP_TAG_THRESHOLD") ?? 0.19),
  clipTagTopN: Number(getEnv("CLIP_TAG_TOP_N") ?? 5),

  // Keyframes sampled per video for visual (CLIP) tagging (video.ts). This is
  // a starting point, not a tuned final value — untested against long videos
  // or ones with fast-changing visual content, where 8 evenly-spaced frames
  // may be too sparse.
  maxVideoFrames: Number(getEnv("MAX_VIDEO_FRAMES") ?? 8),

  // A sampled video frame is dropped (not written to Qdrant at all) if its
  // CLIP embedding is at least this cosine-similar to a frame already kept
  // from the same video in the same indexing run (video.ts). Confirmed live:
  // a static/slow-moving test video had 6 of its 8 sampled frames be
  // near-duplicates, crowding out unrelated real content at retrieval time
  // since searchSimilar's topK is a hard limit applied before any relevance
  // filtering runs. Deliberately high/conservative — this should only catch
  // true near-duplicate frames, not merely similar-looking ones from genuine
  // motion.
  videoFrameDedupeThreshold: Number(getEnv("VIDEO_FRAME_DEDUPE_THRESHOLD") ?? 0.97),
}

export function requireConfig(value: string, name: string): string {
  if (!value) {
    throw new Error(`${name} is not configured`)
  }

  return value
}
