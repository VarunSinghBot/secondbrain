import { config, requireConfig } from "./config"

/**
 * RETRIEVAL_DOCUMENT for content being indexed, RETRIEVAL_QUERY for the user's
 * search question. Gemini embeds each differently — swapping these silently
 * degrades retrieval quality without throwing any error.
 */
export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"

const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${config.embeddingModel}:embedContent`

function normalizeVector(values: number[]): number[] {
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0))
  return magnitude > 0 ? values.map((v) => v / magnitude) : values
}

export async function embedText(text: string, taskType: EmbeddingTaskType): Promise<number[]> {
  const apiKey = requireConfig(config.geminiApiKey, "GEMINI_API_KEY")

  const response = await fetch(EMBED_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      taskType,
      content: { parts: [{ text }] },
      outputDimensionality: config.qdrantVectorSize,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => "")
    throw new Error(`Gemini embedContent failed (${response.status} ${response.statusText}): ${errText}`)
  }

  const data = (await response.json()) as { embedding?: { values?: number[] } }
  const values = data.embedding?.values
  if (!values || !Array.isArray(values) || values.length === 0) {
    throw new Error(`Gemini embedContent response missing embedding values: ${JSON.stringify(data)}`)
  }

  // gemini-embedding-001 only auto-normalizes the full 3072-dim output; any
  // truncated outputDimensionality (768 here) must be renormalized manually,
  // per Google's documented caveat for this model.
  return normalizeVector(values)
}

export async function embedBatch(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]> {
  if (texts.length === 0) return []
  return Promise.all(texts.map((t) => embedText(t, taskType)))
}
