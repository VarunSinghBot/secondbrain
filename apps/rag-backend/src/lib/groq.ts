import { setTimeout as delay } from "node:timers/promises"
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

// qwen3.6-27b's rate limit (8000 TPM at last check) is easy to cross partway
// through a single video's frame batch (~2100-2300 tokens/caption call, so
// just 4 back-to-back calls can exceed it) — every 429 after that point used
// to fall back to a generic caption on the very first rate-limit response.
// Retrying gives Groq's own window a chance to clear before giving up.
const CAPTION_MAX_RETRIES = 3
const CAPTION_BACKOFF_BASE_MS = 1000
const CAPTION_BACKOFF_CAP_MS = 8000

// Groq doesn't consistently send a standard Retry-After header on 429s, but
// its error body includes a human-readable hint ("Please try again in
// 14.69s") — parsed as a fallback so backoff honors the server's own
// estimate instead of guessing blind and retrying into the same window.
function parseRetryDelayMs(response: Response, errorBody: string): number | null {
  const header = response.headers.get("retry-after")
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  }
  const hint = errorBody.match(/try again in ([\d.]+)s/i)
  if (hint) {
    const seconds = Number(hint[1])
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  }
  return null
}

/**
 * Real free-text captioning via a vision-capable Groq model, replacing
 * CLIP's forced-choice zero-shot tagging (see config.useClipZeroShotTagging
 * for why). This caption is what gets Gemini-embedded into rag_text and
 * later shown to the answer LLM as context, so it needs to actually
 * describe the image rather than pick from a fixed vocabulary.
 *
 * Retries on 429 (rate limit) with backoff before giving up — callers still
 * see a thrown error (and fall back to a generic caption) if every retry is
 * also rate-limited, but that's now the last resort, not the first response
 * to a single rate-limit hit.
 */
export async function captionImage(imageBuffer: Buffer, mimeType = "image/jpeg"): Promise<string> {
  const apiKey = requireConfig(config.groqApiKey, "GROQ_API_KEY")
  const base64 = imageBuffer.toString("base64")
  const requestBody = JSON.stringify({
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
  })

  for (let attempt = 0; ; attempt++) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: requestBody,
    })

    if (response.ok) {
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const caption = data.choices?.[0]?.message?.content?.trim()
      if (!caption) throw new Error("Groq image captioning response returned empty content")
      return caption
    }

    const errText = await response.text().catch(() => "")

    if (response.status === 429 && attempt < CAPTION_MAX_RETRIES) {
      const backoffMs = Math.min(CAPTION_BACKOFF_BASE_MS * 2 ** attempt, CAPTION_BACKOFF_CAP_MS)
      const waitMs = Math.max(backoffMs, parseRetryDelayMs(response, errText) ?? 0) + Math.random() * 250
      console.warn(`captionImage: Groq rate-limited (429) — retrying in ${Math.round(waitMs)}ms (attempt ${attempt + 1}/${CAPTION_MAX_RETRIES})`)
      await delay(waitMs)
      continue
    }

    throw new Error(`Groq image captioning failed (${response.status}): ${errText}`)
  }
}

// Deliberately conservative — an earlier version told the model to "expand
// vague pronouns" and "make an implicit ask explicit," which let it invent
// specifics the user never stated (e.g. turning "lab stuff" into "laboratory
// experiment documentation"), corrupting retrieval instead of improving it.
// This version only licenses mechanical cleanup; scope/vagueness stays as-is.
const QUERY_REWRITE_SYSTEM_PROMPT =
  "You rewrite a user's search query so it retrieves better from their personal notes. You do NOT answer it.\n\n" +
  "Rules:\n" +
  "- Fix spelling, grammar, and punctuation only.\n" +
  "- Preserve the exact meaning and scope. Never add detail the user didn't state. \"lab stuff\" stays \"lab stuff\" — do not expand it to \"laboratory experiment documentation\" or invent specifics.\n" +
  "- Keep the user's own words and phrasing wherever they're already valid. Keep first person (\"did I\", \"my notes\").\n" +
  "- Do not add, remove, or reorder the intent. Do not make a vague query specific.\n" +
  "- If the query is already well-formed, return it unchanged.\n" +
  "- If the input is not a question or search query, return it exactly as given.\n" +
  "- Output ONLY the rewritten query — no quotes, no backticks, no preamble, no explanation, no answer to the query. One line, plain text."

// Runs on the critical path of every askWithRag() call, so it's held to a
// tight timeout — a slow or failed rewrite must degrade to the original raw
// query (see caller) rather than stall retrieval.
const QUERY_REWRITE_TIMEOUT_MS = 3000

/**
 * Rewrites a raw user question into a clearer, more search-friendly form
 * before it's embedded for retrieval. Never throws: any failure (bad
 * response, network error, timeout) falls back to returning the original
 * query unchanged, so this can never become a new point of failure for
 * askWithRag(). The original (not rewritten) query is still what's passed
 * to answer generation and shown to the user — only retrieval sees the
 * rewritten form.
 */
export async function rewriteQueryForRetrieval(query: string): Promise<string> {
  if (!config.groqApiKey) return query

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), QUERY_REWRITE_TIMEOUT_MS)

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.groqQueryRewriteModel,
        messages: [
          { role: "system", content: QUERY_REWRITE_SYSTEM_PROMPT },
          { role: "user", content: query },
        ],
        temperature: 0.1,
        max_tokens: 150,
        // gpt-oss-20b rejects "none" (unlike the qwen caption model) — "low"
        // is the cheapest accepted value and still leaves room in max_tokens
        // for real content after the hidden reasoning tokens.
        reasoning_effort: "low",
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      console.warn(`rewriteQueryForRetrieval: Groq returned ${response.status} — using raw query`)
      return query
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const rewritten = data.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, "")
    return rewritten || query
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn(`rewriteQueryForRetrieval: failed (${reason}) — using raw query`)
    return query
  } finally {
    clearTimeout(timeout)
  }
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