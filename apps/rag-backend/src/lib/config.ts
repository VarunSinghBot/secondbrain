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
  groqApiKey: cleanEnv(getEnv("GROQ_API_KEY")),
  ocrSpaceApiKey: cleanEnv(getEnv("OCR_SPACE_API_KEY")),
  llamaCloudApiKey: cleanEnv(getEnv("LLAMA_CLOUD_API_KEY")),
  qdrantUrl: cleanEnv(getEnv("QDRANT_URL")),
  qdrantApiKey: cleanEnv(getEnv("QDRANT_API_KEY")),
  qdrantCollection: cleanEnv(getEnv("QDRANT_COLLECTION"), "rag_text"),
  qdrantImageCollection: cleanEnv(getEnv("QDRANT_IMAGE_COLLECTION"), "rag_images"),
  clipSidecarUrl: cleanEnv(getEnv("CLIP_SIDECAR_URL"), "http://localhost:8001"),
  embeddingModel: cleanEnv(getEnv("GROQ_EMBEDDING_MODEL"), "nomic-embed-text-v1.5"),
  answerModel: cleanEnv(getEnv("GROQ_LLM_MODEL"), "llama-3.3-70b-versatile"),
  groqLlmModel: cleanEnv(getEnv("GROQ_LLM_MODEL"), "llama-3.3-70b-versatile"),
  groqAsrModel: cleanEnv(getEnv("GROQ_ASR_MODEL"), "whisper-large-v3"),
  cloudinaryCloudName: cleanEnv(getEnv("CLOUDINARY_CLOUD_NAME")),
  cloudinaryApiKey: cleanEnv(getEnv("CLOUDINARY_API_KEY")),
  cloudinaryApiSecret: cleanEnv(getEnv("CLOUDINARY_API_SECRET")),
  qdrantVectorSize: Number(getEnv("QDRANT_VECTOR_SIZE") ?? 768),
  minRelevanceScore: Number(getEnv("MIN_RELEVANCE_SCORE") ?? 0.2),
}

export function requireConfig(value: string, name: string): string {
  if (!value) {
    throw new Error(`${name} is not configured`)
  }

  return value
}