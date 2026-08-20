import { config, requireConfig } from "./config"

export async function transcribeAudio(buffer: Buffer, fileName = "audio.mp3"): Promise<string> {
  const apiKey = requireConfig(config.groqApiKey, "GROQ_API_KEY")
  const formData = new FormData()
  formData.append("model", config.groqAsrModel || "whisper-large-v3")
  formData.append("file", new Blob([buffer]), fileName)
  formData.append("response_format", "json")

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => "")
    throw new Error(`Groq transcription failed (${response.status} ${response.statusText}): ${errText}`)
  }

  const data = (await response.json()) as { text?: string }
  if (!data.text) throw new Error("Groq transcription response missing text")
  return data.text
}

export interface GroqChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export async function generateGroqAnswer(
  systemPromptOrPrompt: string,
  userPrompt?: string,
  model = config.groqLlmModel
): Promise<string> {
  const apiKey = requireConfig(config.groqApiKey, "GROQ_API_KEY")

  const messages: GroqChatMessage[] = userPrompt
    ? [
        { role: "system", content: systemPromptOrPrompt },
        { role: "user", content: userPrompt },
      ]
    : [{ role: "user", content: systemPromptOrPrompt }]

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "openai/gpt-oss-120b",
      messages,
      temperature: 0.2,
      max_tokens: 1024,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => "")
    throw new Error(`Groq chat completion failed (${response.status}): ${errText}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error("Groq LLM response returned empty content")
  return content
}