import { config } from "./config"

/**
 * Represents a single retrieved source context entry passed to the LLM.
 */
export interface RAGSourceContext {
  index: number
  contentId: string
  sourceType: string
  sourceName?: string | null
  sourceUrl?: string | null
  cloudinaryUrl?: string | null
  text: string
  score: number
}

/**
 * Result returned by the input query validation guardrail.
 */
export interface GuardrailValidationResult {
  isValid: boolean
  sanitizedQuery: string
  error?: string
}

/**
 * Result returned by the context relevance evaluation guardrail.
 */
export interface GuardrailContextCheckResult {
  hasSufficientContext: boolean
  filteredSources: RAGSourceContext[]
  maxScore: number
}

/**
 * GUARDRAIL 1 — Input Validation & Sanitization
 * Validates incoming user queries for:
 * - Non-empty string constraint
 * - Length limits (max 2000 characters)
 * - Basic prompt injection & override pattern detection
 *
 * @param query Raw search query string from user input
 */
export function validateUserQuery(query: string): GuardrailValidationResult {
  if (!query || typeof query !== "string") {
    return { isValid: false, sanitizedQuery: "", error: "Query must be a non-empty string." }
  }

  const sanitized = query.trim()
  if (sanitized.length === 0) {
    return { isValid: false, sanitizedQuery: "", error: "Query cannot be empty." }
  }

  if (sanitized.length > 2000) {
    return { isValid: false, sanitizedQuery: "", error: "Query exceeds maximum allowed length of 2000 characters." }
  }

  // Detect common prompt injection / jailbreak patterns
  const injectionPatterns = [
    /ignore previous instructions/i,
    /system prompt override/i,
    /forget all rules/i,
    /bypass safety/i,
  ]

  for (const pattern of injectionPatterns) {
    if (pattern.test(sanitized)) {
      return { isValid: false, sanitizedQuery: sanitized, error: "Query contains restricted injection patterns." }
    }
  }

  return { isValid: true, sanitizedQuery: sanitized }
}

/**
 * GUARDRAIL 2 — Context Relevance & Similarity Cutoff
 * Filters vector search hits returned from Qdrant against a minimum similarity threshold.
 * Ensures the system does not inject low-confidence, irrelevant context into the prompt.
 *
 * @param sources List of retrieved source hits from vector search
 * @param minScore Minimum acceptable cosine similarity score cutoff
 */
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

/**
 * GUARDRAIL 3 — Grounded System Prompt & Citation Formatting
 * Generates system instructions instructing the LLM to:
 * 1. Rely strictly on provided context snippets.
 * 2. Return an explicit "insufficient context" message when evidence is missing.
 * 3. Include numeric citations like [1], [2].
 * 4. Include Cloudinary CDN URLs when media items are referenced.
 */
export function buildGroundedSystemPrompt(): string {
  return [
    "You are a precise AI assistant with access to a personal multimodal knowledge base.",
    "The knowledge base contains text notes, documents, image descriptions, audio transcripts, and video content.",
    "Answer the user's question using ONLY the provided context snippets.",
    "If the context is insufficient or missing, state clearly: 'I could not find sufficient context in your knowledge base to answer this question accurately.' — do not hallucinate.",
    "Cite the source index like [1], [2] when you use a context snippet.",
    "If a Cloudinary URL is provided in the source metadata, mention it so the user can inspect the original media file.",
  ].join("\n")
}

/**
 * GUARDRAIL 4 — Grounding Verification & Response Bounding
 * Ensures that if search context is missing or low-confidence, the response explicitly
 * declines to generate speculative answers.
 *
 * @param answer Raw LLM generation output
 * @param hasSufficientContext Flag indicating whether relevance cutoff passed
 */
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
