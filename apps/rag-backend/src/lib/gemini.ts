import { config, requireConfig } from "./config"

export async function createEmbedding(text: string): Promise<number[]> {
  const apiKey = requireConfig(config.geminiApiKey, "GEMINI_API_KEY")
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

  const data = await response.json() as { embedding?: { values?: number[] } }
  const values = data.embedding?.values
  if (!values?.length) throw new Error("Gemini embedding response missing values")
  return values
}

export async function generateAnswer(prompt: string): Promise<string> {
  const apiKey = requireConfig(config.geminiApiKey, "GEMINI_API_KEY")
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

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const answer = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim()
  if (!answer) throw new Error("Gemini answer response missing text")
  return answer
}