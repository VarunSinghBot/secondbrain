import { config, requireConfig } from "./config"

export async function transcribeAudio(buffer: Buffer, fileName = "audio.mp3"): Promise<string> {
  const apiKey = requireConfig(config.groqApiKey, "GROQ_API_KEY")
  const formData = new FormData()
  formData.append("model", "whisper-large-v3")
  formData.append("file", new Blob([buffer]), fileName)
  formData.append("response_format", "json")

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Groq transcription failed: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as { text?: string }
  if (!data.text) throw new Error("Groq transcription response missing text")
  return data.text
}