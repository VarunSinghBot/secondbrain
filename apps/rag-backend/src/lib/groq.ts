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

const CAPTION_PROMPT =
  "Describe this image in one or two concise sentences, focused on concrete visual content: objects, people, setting, and any visible text. Do not speculate beyond what's visible, and do not add commentary."

/**
 * Real free-text captioning via a vision-capable Groq model, replacing
 * CLIP's forced-choice zero-shot tagging (see config.useClipZeroShotTagging
 * for why). This caption is what gets Gemini-embedded into rag_text and
 * later shown to the answer LLM as context, so it needs to actually
 * describe the image rather than pick from a fixed vocabulary.
 */
export async function captionImage(imageBuffer: Buffer, mimeType = "image/jpeg"): Promise<string> {
  const apiKey = requireConfig(config.groqApiKey, "GROQ_API_KEY")
  const base64 = imageBuffer.toString("base64")

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.groqCaptionModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: CAPTION_PROMPT },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
      // qwen3.6-27b is a reasoning model — without this it spends the whole
      // max_tokens budget on a hidden <think> block and never emits content.
      reasoning_effort: "none",
      max_tokens: 200,
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => "")
    throw new Error(`Groq image captioning failed (${response.status}): ${errText}`)
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const caption = data.choices?.[0]?.message?.content?.trim()
  if (!caption) throw new Error("Groq image captioning response returned empty content")
  return caption
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