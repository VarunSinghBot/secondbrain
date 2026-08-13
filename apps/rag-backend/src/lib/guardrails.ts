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
    "If a Cloudinary URL is provided in the source metadata, mention it so the user can inspect the original media file.",
    "",
    `CONTEXT:\n${contextStr}`,
  ].join("\n")
}

function roundScore(score: number): number {
  return Math.round(score * 10000) / 10000
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
