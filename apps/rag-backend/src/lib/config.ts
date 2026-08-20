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
  // Fixed, not env-overridable: Qdrant vectors and Gemini's outputDimensionality
  // are tied to this exact model, so swapping it requires a deliberate migration.
  embeddingModel: "gemini-embedding-001" as const,
  // llama-3.3-70b-versatile was retired from Groq's catalog (confirmed via a
  // live /openai/v1/models check — no llama chat model remains available;
  // only whisper, gpt-oss, qwen, and groq/compound are offered now).
  answerModel: cleanEnv(getEnv("GROQ_LLM_MODEL"), "openai/gpt-oss-120b"),
  groqLlmModel: cleanEnv(getEnv("GROQ_LLM_MODEL"), "openai/gpt-oss-120b"),
  groqAsrModel: cleanEnv(getEnv("GROQ_ASR_MODEL"), "whisper-large-v3"),
  cloudinaryCloudName: cleanEnv(getEnv("CLOUDINARY_CLOUD_NAME")),
  cloudinaryApiKey: cleanEnv(getEnv("CLOUDINARY_API_KEY")),
  cloudinaryApiSecret: cleanEnv(getEnv("CLOUDINARY_API_SECRET")),
  qdrantVectorSize: Number(getEnv("QDRANT_VECTOR_SIZE") ?? 768),

  // ─── RAG retrieval relevance thresholds (askWithRag, services/indexer.ts) ───
  // Defaults below are carried over unchanged from the values that were
  // previously hardcoded/documented, NOT re-tuned. They were set against the
  // old hash-based fallback embedding, and cosine similarity distributions
  // differ meaningfully between that and Gemini's real embeddings (Task 1),
  // so these need empirical re-tuning now that retrieval runs on real
  // embeddings — that re-tuning has not happened yet, do not hand-guess.

  // Floor applied to note/text hits and to CLIP image hits via
  // validateContextRelevance() — hits scoring below this are dropped before
  // being considered as context. Was config.ts's pre-existing default.
  minRelevanceScore: Number(getEnv("MIN_RELEVANCE_SCORE") ?? 0.2),

  // Image-tag description chunks live in the text collection with
  // modality="image". They need their own (lower) floor so they don't
  // crowd out real notes/audio/video when the query isn't about images.
  // Was hardcoded as IMAGE_TAG_SCORE_THRESHOLD in indexer.ts.
  imageTagScoreThreshold: Number(getEnv("IMAGE_TAG_SCORE_THRESHOLD") ?? 0.35),

  // Symmetric relevance balancing: when the top CLIP image score beats the
  // top text score, the query looks image-focused, so text hits are held to
  // this stricter floor instead of minRelevanceScore. Was hardcoded inline
  // in indexer.ts's askWithRag (also 0.35, same value as the threshold above
  // by coincidence — they gate different things).
  imageFocusedTextScoreThreshold: Number(getEnv("IMAGE_FOCUSED_TEXT_SCORE_THRESHOLD") ?? 0.35),

  // Overall gate: if every retrieved hit (text + image) scores below this,
  // nothing is truly relevant to the query and askWithRag short-circuits
  // with the "no sufficient context" fallback instead of calling the LLM.
  // Was hardcoded as MIN_OVERALL_SCORE in indexer.ts.
  minOverallScore: Number(getEnv("MIN_OVERALL_SCORE") ?? 0.21),
}

export function requireConfig(value: string, name: string): string {
  if (!value) {
    throw new Error(`${name} is not configured`)
  }

  return value
}