import { randomUUID } from "node:crypto"

import type { RagIndexRequest } from "@secondbrain/types"

import { config } from "../lib/config"
import { createEmbedding, generateAnswer as generateGeminiAnswer } from "../lib/gemini"
import { extractImageText } from "../lib/ocr"
import { deleteContentVectors, deleteUserVectors, searchSimilar, upsertChunk } from "../lib/qdrant"
import { chunkText, normalizeText } from "../lib/text"
import { extractVideoText } from "../lib/video"
import { transcribeAudio, generateGroqAnswer } from "../lib/groq"
import { downloadUrl } from "../lib/download"
import { parseDocumentFromUrl } from "../lib/llamaparse"
import { uploadToCloudinary } from "../lib/cloudinary"
import {
  validateUserQuery,
  validateContextRelevance,
  buildGroundedSystemPrompt,
  enforceGroundingGuardrail,
  RAGSourceContext,
} from "../lib/guardrails"

interface ExtractedMediaInfo {
  text: string
  cloudinaryUrl?: string | null
  modality: string
}

/**
 * Extracts indexable text and persistent Cloudinary CDN URL from incoming content items.
 */
async function extractSourceText(payload: RagIndexRequest): Promise<ExtractedMediaInfo> {
  const providedText = normalizeText(payload.text ?? "")
  const sourceUrl = payload.sourceUrl ?? undefined
  let cloudinaryUrl: string | null = null

  if (payload.sourceType === "article" || payload.sourceType === "shared-note" || payload.sourceType === "message") {
    return { text: providedText, modality: "text", cloudinaryUrl: null }
  }

  if (!sourceUrl) {
    return { text: providedText, modality: payload.sourceType, cloudinaryUrl: null }
  }

  // Upload to Cloudinary CDN if credentials are provided
  if (config.cloudinaryCloudName && config.cloudinaryApiKey && config.cloudinaryApiSecret) {
    try {
      const { buffer } = await downloadUrl(sourceUrl)
      const resourceType =
        payload.sourceType === "image"
          ? "image"
          : payload.sourceType === "video"
          ? "video"
          : "auto"
      const cld = await uploadToCloudinary(buffer, payload.sourceName ?? "asset", resourceType)
      cloudinaryUrl = cld.url
    } catch (err) {
      console.warn("Cloudinary upload fallback to direct URL:", err)
      cloudinaryUrl = sourceUrl
    }
  } else {
    cloudinaryUrl = sourceUrl
  }

  // Modality-specific processing
  if (payload.sourceType === "audio") {
    const { buffer } = await downloadUrl(sourceUrl)
    const text = await transcribeAudio(buffer, payload.sourceName ?? "audio.mp3")
    return { text, modality: "audio", cloudinaryUrl }
  }

  if (payload.sourceType === "image") {
    const { buffer } = await downloadUrl(sourceUrl)
    const text = await extractImageText(buffer, payload.sourceName ?? "image.png")
    return { text, modality: "image", cloudinaryUrl }
  }

  if (payload.sourceType === "video") {
    const text = await extractVideoText(sourceUrl)
    return { text, modality: "video", cloudinaryUrl }
  }

  if (payload.sourceType === "document") {
    const text = await parseDocumentFromUrl(sourceUrl)
    return { text, modality: "document", cloudinaryUrl }
  }

  return { text: providedText, modality: payload.sourceType, cloudinaryUrl }
}

export interface IndexedChunkResult {
  qdrantPointId: string
  chunkIndex: number
  text: string
  tokenCount: number
  cloudinaryUrl?: string | null
}

/**
 * Indexes a content payload into Qdrant vector database:
 * 1. Cleans existing vectors for contentId & userId
 * 2. Extracts text content & uploads media to Cloudinary
 * 3. Chunks text into overlapping segments
 * 4. Generates embeddings & upserts to Qdrant
 */
export async function indexContent(payload: RagIndexRequest): Promise<IndexedChunkResult[]> {
  await deleteContentVectors(payload.userId, payload.contentId)

  const mediaInfo = await extractSourceText(payload)
  const normalized = normalizeText(mediaInfo.text)
  if (!normalized) {
    throw new Error("No indexable text found for content")
  }

  const chunks = chunkText(normalized)
  const results: IndexedChunkResult[] = []

  for (const chunk of chunks) {
    const embedding = await createEmbedding(chunk.text)
    const qdrantPointId = randomUUID()

    await upsertChunk(qdrantPointId, embedding, {
      contentId: payload.contentId,
      userId: payload.userId,
      sourceType: payload.sourceType,
      sourceUrl: payload.sourceUrl ?? null,
      sourceName: payload.sourceName ?? null,
      cloudinaryUrl: mediaInfo.cloudinaryUrl ?? payload.sourceUrl ?? null,
      modality: mediaInfo.modality,
      chunkIndex: chunk.index,
      text: chunk.text,
      metadata: payload.metadata ?? null,
    })

    results.push({
      qdrantPointId,
      chunkIndex: chunk.index,
      text: chunk.text,
      tokenCount: chunk.tokenCount,
      cloudinaryUrl: mediaInfo.cloudinaryUrl ?? payload.sourceUrl ?? null,
    })
  }

  return results
}

/**
 * Re-indexes all contents for a specific user.
 */
export async function reindexUserContent(
  userId: string,
  contents: RagIndexRequest[],
  force = false
): Promise<{ scanned: number; reindexed: number; failed: number; skipped: number }> {
  if (force) {
    await deleteUserVectors(userId)
  }

  let reindexed = 0
  let failed = 0
  let skipped = 0

  for (const content of contents) {
    if (!force && content.metadata?.alreadyIndexed === true) {
      skipped += 1
      continue
    }

    try {
      await indexContent(content)
      reindexed += 1
    } catch (error) {
      console.error(`Failed to reindex ${content.contentId}:`, error)
      failed += 1
    }
  }

  return {
    scanned: contents.length,
    reindexed,
    failed,
    skipped,
  }
}

/**
 * Executes full Guardrailed RAG question answering pipeline:
 * 1. Input Guardrail: Sanitizes query & rejects invalid/injection queries.
 * 2. Vector Retrieval: Queries Qdrant for top-K matching vectors scoped to userId.
 * 3. Relevance Guardrail: Filters search hits by similarity score cutoff.
 * 4. Grounded Prompt Construction: Prepares strict system prompt with citations & Cloudinary CDN links.
 * 5. Model Generation: Queries Groq LLaMA-3 (or Gemini as fallback).
 * 6. Grounding Guardrail: Validates output and enforces ungrounded fallback if insufficient context.
 */
export async function askWithRag(userId: string, query: string, topK = 5) {
  // 1. Input Guardrail
  const validation = validateUserQuery(query)
  if (!validation.isValid) {
    throw new Error(validation.error ?? "Invalid query provided.")
  }

  const sanitizedQuery = validation.sanitizedQuery

  // 2. Vector Similarity Search via Qdrant
  const queryEmbedding = await createEmbedding(sanitizedQuery)
  const hits = await searchSimilar(queryEmbedding, userId, topK)

  const sources: RAGSourceContext[] = hits.map((hit, idx) => {
    const payload = (hit.payload ?? {}) as Record<string, unknown>
    return {
      index: idx + 1,
      score: hit.score,
      contentId: String(payload.contentId ?? ""),
      sourceType: String(payload.sourceType ?? "article"),
      sourceUrl: (payload.sourceUrl as string | undefined) ?? null,
      sourceName: (payload.sourceName as string | undefined) ?? null,
      cloudinaryUrl: (payload.cloudinaryUrl as string | undefined) ?? null,
      text: String(payload.text ?? ""),
    }
  })

  // 3. Relevance & Context Guardrail
  const relevance = validateContextRelevance(sources)
  const activeSources = relevance.filteredSources

  // Build context payload
  const contextString = activeSources.length > 0
    ? activeSources
        .map((source) => {
          const cldStr = source.cloudinaryUrl ? ` | Cloudinary CDN: ${source.cloudinaryUrl}` : ""
          return `[${source.index}] Title: ${source.sourceName ?? source.contentId} | Type: ${source.sourceType}${cldStr}\nContent: ${source.text}`
        })
        .join("\n\n")
    : "No relevant context found in the knowledge base."

  const systemPrompt = buildGroundedSystemPrompt()
  const userPrompt = `CONTEXT:\n${contextString}\n\nQUESTION: ${sanitizedQuery}`

  let answer = ""
  if (config.groqApiKey) {
    try {
      answer = await generateGroqAnswer(systemPrompt, userPrompt)
    } catch (err) {
      console.warn("Groq generation failed, falling back to Gemini:", err)
      const prompt = `${systemPrompt}\n\n${userPrompt}`
      answer = await generateGeminiAnswer(prompt)
    }
  } else {
    const prompt = `${systemPrompt}\n\n${userPrompt}`
    answer = await generateGeminiAnswer(prompt)
  }

  // 4. Enforce Grounding Guardrail
  const groundedResult = enforceGroundingGuardrail(answer, relevance.hasSufficientContext)

  return {
    answer: groundedResult.finalAnswer,
    prompt: userPrompt,
    sources: activeSources.map((s) => ({
      contentId: s.contentId,
      sourceName: s.sourceName,
      sourceType: s.sourceType,
      sourceUrl: s.cloudinaryUrl ?? s.sourceUrl,
      chunkIndex: s.index,
      score: s.score,
    })),
  }
}