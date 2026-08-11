function cleanEnv(val: string | undefined, defaultVal = ""): string {
  if (!val) return defaultVal
  let trimmed = val.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    trimmed = trimmed.slice(1, -1).trim()
  }
  return trimmed || defaultVal
}

export const config = {
  port: Number(process.env.RAG_BACKEND_PORT ?? 8090),
  geminiApiKey: cleanEnv(process.env.GEMINI_API_KEY),
  groqApiKey: cleanEnv(process.env.GROQ_API_KEY),
  ocrSpaceApiKey: cleanEnv(process.env.OCR_SPACE_API_KEY),
  llamaCloudApiKey: cleanEnv(process.env.LLAMA_CLOUD_API_KEY),
  qdrantUrl: cleanEnv(process.env.QDRANT_URL),
  qdrantApiKey: cleanEnv(process.env.QDRANT_API_KEY),
  qdrantCollection: cleanEnv(process.env.QDRANT_COLLECTION, "secondbrain-rag"),
  embeddingModel: cleanEnv(process.env.GEMINI_EMBEDDING_MODEL, "text-embedding-004"),
  answerModel: cleanEnv(process.env.GEMINI_CHAT_MODEL, "gemini-2.0-flash"),
  groqLlmModel: cleanEnv(process.env.GROQ_LLM_MODEL, "llama-3.3-70b-versatile"),
  groqAsrModel: cleanEnv(process.env.GROQ_ASR_MODEL, "whisper-large-v3"),
  cloudinaryCloudName: cleanEnv(process.env.CLOUDINARY_CLOUD_NAME),
  cloudinaryApiKey: cleanEnv(process.env.CLOUDINARY_API_KEY),
  cloudinaryApiSecret: cleanEnv(process.env.CLOUDINARY_API_SECRET),
  qdrantVectorSize: Number(process.env.QDRANT_VECTOR_SIZE ?? 768),
  minRelevanceScore: Number(process.env.MIN_RELEVANCE_SCORE ?? 0.35),
}

export function requireConfig(value: string, name: string): string {
  if (!value) {
    throw new Error(`${name} is not configured`)
  }

  return value
}