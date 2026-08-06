import { randomUUID } from "node:crypto"

import type { RagIndexRequest } from "@secondbrain/types"

import { config } from "../lib/config"
import { createEmbedding } from "../lib/gemini"
import { extractImageText } from "../lib/ocr"
import { deleteContentVectors, deleteUserVectors, searchSimilar, upsertChunk } from "../lib/qdrant"
import { chunkText, normalizeText } from "../lib/text"
import { extractVideoText } from "../lib/video"
import { transcribeAudio } from "../lib/groq"
import { downloadUrl } from "../lib/download"
import { parseDocumentFromUrl } from "../lib/llamaparse"

async function extractSourceText(payload: RagIndexRequest): Promise<string> {
  const providedText = normalizeText(payload.text ?? "")
  const sourceUrl = payload.sourceUrl ?? undefined

  if (payload.sourceType === "article" || payload.sourceType === "shared-note" || payload.sourceType === "message") {
    return providedText
  }

  if (!sourceUrl) return providedText

  if (payload.sourceType === "audio") {
    const { buffer } = await downloadUrl(sourceUrl)
    return transcribeAudio(buffer, payload.sourceName ?? "audio.mp3")
  }

  if (payload.sourceType === "image") {
    const { buffer } = await downloadUrl(sourceUrl)
    return extractImageText(buffer, payload.sourceName ?? "image.png")
  }

  if (payload.sourceType === "video") {
    return extractVideoText(sourceUrl)
  }

  if (payload.sourceType === "document") {
    if (!sourceUrl) return providedText
    return parseDocumentFromUrl(sourceUrl)
  }

  return providedText
}

export interface IndexedChunkResult {
  qdrantPointId: string
  chunkIndex: number
  text: string
  tokenCount: number
}

export async function indexContent(payload: RagIndexRequest): Promise<IndexedChunkResult[]> {
  await deleteContentVectors(payload.userId, payload.contentId)

  const extractedText = await extractSourceText(payload)
  const normalized = normalizeText(extractedText)
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
      chunkIndex: chunk.index,
      text: chunk.text,
      metadata: payload.metadata ?? null,
    })

    results.push({
      qdrantPointId,
      chunkIndex: chunk.index,
      text: chunk.text,
      tokenCount: chunk.tokenCount,
    })
  }

  return results
}

export async function reindexUserContent(userId: string, contents: RagIndexRequest[], force = false): Promise<{ scanned: number; reindexed: number; failed: number; skipped: number }> {
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

export async function askWithRag(userId: string, query: string, topK = 5) {
  const queryEmbedding = await createEmbedding(query)
  const hits = await searchSimilar(queryEmbedding, userId, topK)

  const sources = hits.map((hit) => {
    const payload = (hit.payload ?? {}) as Record<string, unknown>
    return {
      id: String(hit.id),
      score: hit.score,
      contentId: String(payload.contentId ?? ""),
      sourceType: String(payload.sourceType ?? "article"),
      sourceUrl: (payload.sourceUrl as string | undefined) ?? null,
      sourceName: (payload.sourceName as string | undefined) ?? null,
      chunkIndex: Number(payload.chunkIndex ?? 0),
      text: String(payload.text ?? ""),
    }
  })

  const context = sources
    .map((source, index) => `Source ${index + 1}:\nTitle: ${source.sourceName ?? source.contentId}\nType: ${source.sourceType}\nChunk: ${source.text}`)
    .join("\n\n")

  const prompt = [
    "You are answering questions from the user's private knowledge base.",
    "Use only the provided context.",
    "If the context is insufficient, say that you could not find enough evidence.",
    "Return a concise answer with citations references like [1], [2].",
    "",
    `Question: ${query}`,
    "",
    `Context:\n${context}`,
  ].join("\n")

  return {
    prompt,
    sources,
  }
}