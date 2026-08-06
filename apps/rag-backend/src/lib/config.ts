export const config = {
  port: Number(process.env.RAG_BACKEND_PORT ?? 8090),
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  ocrSpaceApiKey: process.env.OCR_SPACE_API_KEY ?? "",
  llamaCloudApiKey: process.env.LLAMA_CLOUD_API_KEY ?? "",
  qdrantUrl: process.env.QDRANT_URL ?? "",
  qdrantApiKey: process.env.QDRANT_API_KEY ?? "",
  qdrantCollection: process.env.QDRANT_COLLECTION ?? "secondbrain-rag",
  embeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? "text-embedding-004",
  answerModel: process.env.GEMINI_CHAT_MODEL ?? "gemini-2.0-flash",
  qdrantVectorSize: Number(process.env.QDRANT_VECTOR_SIZE ?? 768),
}

export function requireConfig(value: string, name: string): string {
  if (!value) {
    throw new Error(`${name} is not configured`)
  }

  return value
}