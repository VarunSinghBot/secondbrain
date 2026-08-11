import { config } from "./config"

/**
 * Generates a deterministic normalized pseudo-embedding vector of dimension `dim`
 * as a fallback when GEMINI_API_KEY is not configured.
 */
function createDeterministicFallbackEmbedding(text: string, dim = config.qdrantVectorSize): number[] {
  const vector = new Array(dim).fill(0)
  const normalizedText = text.toLowerCase()

  for (let i = 0; i < normalizedText.length; i++) {
    const charCode = normalizedText.charCodeAt(i)
    const idx = (charCode * 31 + i * 17) % dim
    vector[idx] += 1
  }

  // Calculate L2 norm for vector normalization
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1
  return vector.map((val) => val / magnitude)
}

export async function createEmbedding(text: string): Promise<number[]> {
  const apiKey = config.geminiApiKey

  if (!apiKey) {
    console.warn("GEMINI_API_KEY not set. Using deterministic vector embedder fallback.")
    return createDeterministicFallbackEmbedding(text)
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.embeddingModel}:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
    }
  )

  if (!response.ok) {
    throw new Error(`Gemini embedding request failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as { embedding?: { values?: number[] } }
  const values = data.embedding?.values
  if (!values?.length) throw new Error("Gemini embedding response missing values")
  return values
}

export async function generateAnswer(prompt: string): Promise<string> {
  const apiKey = config.geminiApiKey

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured and no alternative model provider was specified")
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.answerModel}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`Gemini generation request failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const answer = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim()
  if (!answer) throw new Error("Gemini answer response missing text")
  return answer
}