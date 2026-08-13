import { config } from "./config"

function createDeterministicEmbedding(text: string, dim = 768): number[] {
  const vector = new Array(dim).fill(0)
  // Tokenize into words of length >= 2
  const words = text.toLowerCase().match(/\b\w{2,}\b/g) || []
  
  for (const word of words) {
    let hash = 5381
    for (let i = 0; i < word.length; i++) {
      hash = (hash * 33) ^ word.charCodeAt(i)
    }
    const idx = Math.abs(hash) % dim
    vector[idx] += 1.0
  }
  
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1
  return vector.map((val) => val / magnitude)
}

export async function embedText(text: string): Promise<number[]> {
  const apiKey = config.groqApiKey
  const model = config.embeddingModel || "nomic-embed-text-v1.5"

  if (apiKey) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: text,
          model,
        }),
      })

      if (response.ok) {
        const data = (await response.json()) as {
          data?: Array<{ embedding?: number[] }>
        }
        const embedding = data.data?.[0]?.embedding
        if (embedding && Array.isArray(embedding) && embedding.length > 0) {
          return embedding
        }
      }
    } catch {
      // Fallback below
    }
  }

  // Graceful deterministic 768-dim fallback
  return createDeterministicEmbedding(text, config.qdrantVectorSize || 768)
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  return Promise.all(texts.map((t) => embedText(t)))
}
