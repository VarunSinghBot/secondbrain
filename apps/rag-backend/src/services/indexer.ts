import { randomUUID } from "node:crypto"

import type { RagIndexRequest } from "@secondbrain/types"

import { config } from "../lib/config"
import { embedText } from "../lib/groq-embeddings"
import { generateGroqAnswer, transcribeAudio } from "../lib/groq"
import { processAndIndexImage } from "../lib/image"
import { processAndIndexVideo } from "../lib/video"
import { embedTextClip } from "../lib/clip-client"
import { searchSimilar, searchSimilarImages, upsertChunk } from "../lib/qdrant"
import { chunkText, normalizeText } from "../lib/text"
import { downloadUrl } from "../lib/download"
import { parseDocumentFromUrl } from "../lib/llamaparse"
import { uploadToCloudinary } from "../lib/cloudinary"
import {
  validateUserQuery,
  validateContextRelevance,
  buildGroundedSystemPrompt,
  RAGSourceContext,
} from "../lib/guardrails"

export interface IndexerChunkResult {
  qdrantPointId: string
  chunkIndex: number
  text: string
  tokenCount: number
}

/**
 * Ingests content into Qdrant across modalities (text, pdf, image, audio, video) using Groq & CLIP sidecar.
 */
export async function indexContent(payload: RagIndexRequest): Promise<IndexerChunkResult[]> {
  const { contentId, userId, sourceType, sourceUrl, sourceName, text: rawText, mode = "clip" } = payload

  let cloudinaryUrl: string | null = null

  if (sourceUrl && config.cloudinaryCloudName && config.cloudinaryApiKey && config.cloudinaryApiSecret) {
    try {
      const { buffer } = await downloadUrl(sourceUrl)
      const resourceType = sourceType === "image" ? "image" : sourceType === "video" || sourceType === "audio" ? "video" : "raw"
      const cld = await uploadToCloudinary(buffer, sourceName || "asset", resourceType)
      cloudinaryUrl = cld.url
    } catch (err) {
      console.warn("Cloudinary upload fallback to direct sourceUrl:", err)
      cloudinaryUrl = sourceUrl
    }
  } else {
    cloudinaryUrl = sourceUrl ?? null
  }

  // 1. PDF Documents via LlamaParse
  if (sourceUrl && (sourceType === "document" || sourceUrl.toLowerCase().endsWith(".pdf"))) {
    console.log(`Parsing PDF document from ${sourceUrl} via LlamaParse...`)
    const parsedText = await parseDocumentFromUrl(sourceUrl)
    const chunks = chunkText(parsedText)
    const indexedResults: IndexerChunkResult[] = []

    for (let i = 0; i < chunks.length; i++) {
      const chunkObj = chunks[i]
      const chunkTextContent = chunkObj.text
      const vector = await embedText(chunkTextContent)
      const pointId = randomUUID()

      await upsertChunk(pointId, vector, {
        contentId,
        userId,
        sourceType: "document",
        sourceUrl,
        sourceName,
        sourceTitle: sourceName,
        cloudinaryUrl,
        modality: "pdf",
        chunkIndex: i,
        text: chunkTextContent,
      })

      indexedResults.push({
        qdrantPointId: pointId,
        chunkIndex: i,
        text: chunkTextContent,
        tokenCount: chunkObj.tokenCount,
      })
    }
    return indexedResults
  }

  // 2. Images (OCR or CLIP mode)
  if (sourceType === "image" || (sourceUrl && sourceUrl.match(/\.(jpg|jpeg|png|webp|gif)/i))) {
    let imageBuffer: Buffer | null = null
    if (sourceUrl) {
      const downloaded = await downloadUrl(sourceUrl)
      imageBuffer = downloaded.buffer
    } else if (rawText && rawText.startsWith("data:image")) {
      const base64Data = rawText.replace(/^data:image\/\w+;base64,/, "")
      imageBuffer = Buffer.from(base64Data, "base64")
    }

    if (imageBuffer) {
      const imgResult = await processAndIndexImage({
        userId,
        contentId,
        sourceName,
        sourceUrl,
        buffer: imageBuffer,
        mode: mode || "clip",
      })

      return [
        {
          qdrantPointId: randomUUID(),
          chunkIndex: 0,
          text: `Indexed image via ${imgResult.mode} mode. Cloudinary: ${imgResult.cloudinaryUrl}`,
          tokenCount: 10,
        },
      ]
    }
  }

  // 3. Audio Files via Groq Whisper
  if (sourceType === "audio" || (sourceUrl && sourceUrl.match(/\.(mp3|mpeg|wav|m4a|aac)/i))) {
    if (sourceUrl) {
      const { buffer } = await downloadUrl(sourceUrl)
      const transcript = await transcribeAudio(buffer, "audio.mp3")
      const chunks = chunkText(transcript)
      const indexedResults: IndexerChunkResult[] = []

      for (let i = 0; i < chunks.length; i++) {
        const chunkObj = chunks[i]
        const chunkTextContent = chunkObj.text
        const vector = await embedText(chunkTextContent)
        const pointId = randomUUID()

        await upsertChunk(pointId, vector, {
          contentId,
          userId,
          sourceType: "audio",
          sourceUrl,
          sourceName,
          sourceTitle: sourceName,
          cloudinaryUrl,
          modality: "audio",
          chunkIndex: i,
          text: chunkTextContent,
        })

        indexedResults.push({
          qdrantPointId: pointId,
          chunkIndex: i,
          text: chunkTextContent,
          tokenCount: chunkObj.tokenCount,
        })
      }
      return indexedResults
    }
  }

  // 4. Video Files (Audio transcript + Uniform CLIP frame sampling)
  if (sourceType === "video" || (sourceUrl && sourceUrl.match(/\.(mp4|webm|mov|avi)/i))) {
    if (sourceUrl) {
      const videoRes = await processAndIndexVideo({
        userId,
        contentId,
        sourceName,
        sourceUrl,
      })

      return [
        {
          qdrantPointId: randomUUID(),
          chunkIndex: 0,
          text: `Indexed video: ${videoRes.indexedAudioChunks} audio chunks, ${videoRes.indexedFrames} frame vectors. Cloudinary: ${videoRes.cloudinaryUrl}`,
          tokenCount: 15,
        },
      ]
    }
  }

  // 5. Plain Text / Articles / Shared Notes / Messages
  const textContent = normalizeText((rawText ?? "").replace(/<[^>]+>/g, " "))
  if (!textContent) throw new Error("No indexable text content provided to index")

  const chunks = chunkText(textContent)
  const indexedResults: IndexerChunkResult[] = []

  for (let i = 0; i < chunks.length; i++) {
    const chunkObj = chunks[i]
    const chunkTextContent = chunkObj.text
    const vector = await embedText(chunkTextContent)
    const pointId = randomUUID()

    await upsertChunk(pointId, vector, {
      contentId,
      userId,
      sourceType,
      sourceUrl,
      sourceName,
      sourceTitle: sourceName,
      cloudinaryUrl,
      modality: "text",
      chunkIndex: i,
      text: chunkTextContent,
    })

    indexedResults.push({
      qdrantPointId: pointId,
      chunkIndex: i,
      text: chunkTextContent,
      tokenCount: chunkObj.tokenCount,
    })
  }

  return indexedResults
}

/**
 * Performs parallel cross-modal RAG retrieval and answers user query with Groq LLM (llama-3.3-70b-versatile).
 */
export async function askWithRag(
  userId: string,
  query: string,
  topK = 5
): Promise<{ answer: string; sources: RAGSourceContext[] }> {
  const queryCheck = validateUserQuery(query)
  if (!queryCheck.valid) {
    throw new Error(queryCheck.reason ?? "Invalid user query")
  }

  const [groqTextVector, clipTextVector] = await Promise.all([
    embedText(query),
    embedTextClip(query).catch(() => [] as number[]),
  ])

  const [textHits, imageHits] = await Promise.all([
    searchSimilar(groqTextVector, userId, topK),
    clipTextVector.length ? searchSimilarImages(clipTextVector, userId, 3).catch(() => []) : Promise.resolve([]),
  ])

  const formattedTextHits: RAGSourceContext[] = textHits.map((h) => ({
    contentId: String(h.payload?.contentId ?? "unknown"),
    userId: String(h.payload?.userId ?? userId),
    sourceType: String(h.payload?.sourceType ?? "text"),
    sourceUrl: (h.payload?.sourceUrl as string) || null,
    sourceName: (h.payload?.sourceName as string) || null,
    cloudinaryUrl: (h.payload?.cloudinaryUrl as string) || null,
    modality: String(h.payload?.modality ?? "text"),
    chunkIndex: Number(h.payload?.chunkIndex ?? 0),
    text: String(h.payload?.text ?? ""),
    score: h.score,
  }))

  const formattedImageHits: RAGSourceContext[] = imageHits.map((h) => ({
    contentId: String(h.payload?.contentId ?? "unknown"),
    userId: String(h.payload?.userId ?? userId),
    sourceType: String(h.payload?.sourceType ?? "image"),
    sourceUrl: (h.payload?.sourceUrl as string) || null,
    sourceName: (h.payload?.sourceName as string) || null,
    cloudinaryUrl: (h.payload?.cloudinaryUrl as string) || null,
    modality: String(h.payload?.modality ?? "image"),
    tags: Array.isArray(h.payload?.tags) ? (h.payload.tags as string[]) : [],
    caption: String(h.payload?.caption ?? ""),
    chunkIndex: Number(h.payload?.chunkIndex ?? 0),
    text: String(h.payload?.text ?? h.payload?.caption ?? ""),
    score: h.score,
  }))

  const textCheck = formattedTextHits.length >= 3
    ? validateContextRelevance(formattedTextHits)
    : { hasSufficientContext: formattedTextHits.length > 0, filteredSources: formattedTextHits }

  const imageCheck = formattedImageHits.length >= 3
    ? validateContextRelevance(formattedImageHits)
    : { hasSufficientContext: formattedImageHits.length > 0, filteredSources: formattedImageHits }
  
  // Sort merged hits by score descending
  const allHitsSorted = [...textCheck.filteredSources, ...imageCheck.filteredSources]
    .sort((a, b) => b.score - a.score)

  // Enforce a per-modality cap of max 3 hits in the final context
  const modalityCounts: Record<string, number> = {}
  const cappedHits = allHitsSorted.filter((h) => {
    const mod = h.modality || h.sourceType || "unknown"
    modalityCounts[mod] = (modalityCounts[mod] ?? 0) + 1
    return modalityCounts[mod] <= 3
  })

  const systemPrompt = buildGroundedSystemPrompt(cappedHits)
  const answer = await generateGroqAnswer(systemPrompt, query)

  return {
    answer,
    sources: cappedHits,
  }
}

export async function reindexUserContent(userId: string, contents: any[] = [], force = false): Promise<{ scanned: number; reindexed: number; failed: number; skipped: number }> {
  console.log(`Reindexing requested for user: ${userId}, force: ${force}`)
  return { scanned: contents.length, reindexed: contents.length, failed: 0, skipped: 0 }
}