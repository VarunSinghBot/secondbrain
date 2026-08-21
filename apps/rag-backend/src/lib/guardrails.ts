import { config } from "./config"

export interface RAGSourceContext {
  index?: number
  contentId: string
  userId?: string
  sourceType: string
  sourceName?: string | null
  sourceUrl?: string | null
  cloudinaryUrl?: string | null
  modality?: string
  chunkIndex?: number
  tags?: string[]
  caption?: string
  text: string
  score: number
  // Set for modality "video_frame" once Task 4 lands — where in the source
  // video (in seconds) this frame was sampled from.
  timestampSeconds?: number | null
}

export interface GuardrailValidationResult {
  valid: boolean
  isValid: boolean
  sanitizedQuery: string
  reason?: string
  error?: string
}

export interface GuardrailContextCheckResult {
  hasSufficientContext: boolean
  filteredSources: RAGSourceContext[]
  maxScore: number
}

export function validateUserQuery(query: string): GuardrailValidationResult {
  if (!query || typeof query !== "string") {
    const err = "Query must be a non-empty string."
    return { valid: false, isValid: false, sanitizedQuery: "", reason: err, error: err }
  }

  const sanitized = query.trim()
  if (sanitized.length === 0) {
    const err = "Query cannot be empty."
    return { valid: false, isValid: false, sanitizedQuery: "", reason: err, error: err }
  }

  if (sanitized.length > 2000) {
    const err = "Query exceeds maximum allowed length of 2000 characters."
    return { valid: false, isValid: false, sanitizedQuery: "", reason: err, error: err }
  }

  const injectionPatterns = [
    /ignore previous instructions/i,
    /system prompt override/i,
    /forget all rules/i,
    /bypass safety/i,
  ]

  for (const pattern of injectionPatterns) {
    if (pattern.test(sanitized)) {
      const err = "Query contains restricted injection patterns."
      return { valid: false, isValid: false, sanitizedQuery: sanitized, reason: err, error: err }
    }
  }

  return { valid: true, isValid: true, sanitizedQuery: sanitized }
}

export function validateContextRelevance(
  sources: RAGSourceContext[],
  minScore = config.minRelevanceScore
): GuardrailContextCheckResult {
  const filtered = sources.filter((s) => s.score >= minScore)
  const maxScore = sources.reduce((max, s) => Math.max(max, s.score), 0)

  return {
    hasSufficientContext: filtered.length > 0,
    filteredSources: filtered,
    maxScore,
  }
}

export function buildGroundedSystemPrompt(sources: RAGSourceContext[] = []): string {
  const contextParts: string[] = []

  sources.forEach((s, idx) => {
    const cld = s.cloudinaryUrl ? ` | url: ${s.cloudinaryUrl}` : ""
    const mod = (s.modality || s.sourceType || "TEXT").toUpperCase()
    contextParts.push(`[${idx + 1}] [${mod}] score=${roundScore(s.score)}${cld}\n${s.text || s.caption || "No text available"}`)
  })

  const contextStr = contextParts.length > 0 ? contextParts.join("\n\n") : "No relevant context found in the knowledge base."

  return [
    "You are a precise AI assistant with access to a personal multimodal knowledge base.",
    "The knowledge base contains text notes, documents, image descriptions, audio transcripts, and video content.",
    "Answer the user's question using ONLY the provided context snippets.",
    "If the context is insufficient or missing, state clearly: 'I could not find sufficient context in your knowledge base to answer this question accurately.' — do not hallucinate.",
    "Cite the source index like [1], [2] when you use a context snippet.",
    "Do not paste raw URLs into your answer — the source link is already shown to the user separately via the citation.",
    "",
    "Answer in plain conversational prose, as if speaking to the user directly.",
    "Synthesize the retrieved snippets into a natural answer — do not restate them field by field (e.g. do not write 'Title: ... Content: ... Tags: ...').",
    "Do not use markdown headers or bold text unless the user's question itself asks for a structured list or comparison.",
    "",
    `CONTEXT:\n${contextStr}`,
  ].join("\n")
}

function roundScore(score: number): number {
  return Math.round(score * 10000) / 10000
}

/**
 * Parses which [n] citation markers the model actually used in its answer.
 * Sources are numbered 1-based in the same order buildGroundedSystemPrompt
 * assigned them, so this must be checked against that same source array.
 *
 * openai/gpt-oss-120b doesn't reliably stick to the plain "[1]" ASCII style
 * the prompt asks for — observed in practice: "[1]", full-width "【1】", and
 * "【1†L1-L2】" (extra annotation text before the closing bracket). Rather
 * than chase each new variant as it surfaces (this is the third), this
 * matches any digit run immediately after an opening bracket, ASCII or
 * full-width, regardless of what comes before the closing bracket.
 */
export function citedSourceIndices(answer: string): Set<number> {
  const indices = new Set<number>()
  const pattern = /[\[【](\d+)[^\]】]*[\]】]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(answer))) {
    indices.add(Number(match[1]))
  }
  return indices
}

/**
 * Strips the full-width "【1】" / "【1†L1-L2】" citation markers
 * citedSourceIndices() above matches from the text shown to the user —
 * call this AFTER citedSourceIndices() has already run on the raw answer,
 * since it needs those markers intact to do its matching. Plain ASCII
 * "[1]" style citations are left as-is; they're the format the prompt
 * actually asks for and read fine in the UI.
 */
export function stripCitationMarkers(answer: string): string {
  return answer
    .replace(/【\d+[^】]*】/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

function formatTimestamp(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

/**
 * Human-readable modality label for a cited source, e.g. "Video frame
 * source (at 0:42)" — the timestamp only appears once Task 4 populates
 * timestampSeconds on video_frame sources.
 */
export function labelForSource(source: RAGSourceContext): string {
  const modality = (source.modality || source.sourceType || "text").toLowerCase()

  if (modality === "video_frame") {
    const ts = typeof source.timestampSeconds === "number" ? ` (at ${formatTimestamp(source.timestampSeconds)})` : ""
    return `Video frame source${ts}`
  }
  if (modality === "image") return "Image source"
  if (modality === "audio") return "Audio source"
  if (modality === "video") return "Video source"
  if (modality === "video_audio") return "Video transcript source"
  return "Note source"
}

export function enforceGroundingGuardrail(
  answer: string,
  hasSufficientContext: boolean
): { finalAnswer: string; grounded: boolean } {
  if (!hasSufficientContext) {
    return {
      finalAnswer: "I could not find sufficient context in your knowledge base to answer this question accurately.",
      grounded: true,
    }
  }

  const normalizedAnswer = answer.trim()
  if (!normalizedAnswer) {
    return {
      finalAnswer: "I could not generate an answer based on the provided context.",
      grounded: false,
    }
  }

  return {
    finalAnswer: normalizedAnswer,
    grounded: true,
  }
}
