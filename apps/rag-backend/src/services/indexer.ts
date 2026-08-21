import { randomUUID } from "node:crypto"

import type { RagIndexRequest, RagReindexContentItem } from "@secondbrain/types"

import { config } from "../lib/config"
import { embedText } from "../lib/embeddings"
import { generateGroqAnswer, transcribeAudio } from "../lib/groq"
import { processAndIndexImage } from "../lib/image"
import { processAndIndexVideo } from "../lib/video"
import { embedTextClip } from "../lib/clip-client"
import { deleteContentVectors, searchSimilar, searchSimilarImages, upsertChunk } from "../lib/qdrant"
import { chunkText, normalizeText } from "../lib/text"
import { downloadUrl } from "../lib/download"
import { parseDocumentFromUrl } from "../lib/llamaparse"
import { uploadToCloudinary } from "../lib/cloudinary"
import { prisma } from "../lib/prisma"
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
 * Records what was just indexed in Postgres (RagDocument) so reindexUserContent()
 * can later tell which content was indexed under a stale embeddingModel. This is
 * the single place RagDocument rows are written — callers (apps/web) should not
 * write their own copies, or the two can drift out of sync.
 *
 * Best-effort: the real work (Qdrant vectors) is already done by the time this
 * runs, so a tracking-write failure (e.g. Postgres hiccup, or a contentId with
 * no matching Content row — RagDocument has a real FK to it) must not discard
 * a successful indexing result. Worst case, the next reindex pass treats this
 * content as untracked and re-embeds it — safe, just slightly wasteful.
 */
async function recordIndexing(
  payload: RagIndexRequest,
  results: IndexerChunkResult[]
): Promise<IndexerChunkResult[]> {
  const { contentId, userId, sourceType, sourceUrl, sourceName, parser } = payload

  try {
    await prisma.ragDocument.deleteMany({ where: { contentId } })

    if (results.length > 0) {
      await prisma.ragDocument.createMany({
        data: results.map((r) => ({
          contentId,
          userId,
          sourceType,
          sourceUrl: sourceUrl ?? null,
          sourceName: sourceName ?? null,
          extractedText: r.text,
          chunkIndex: r.chunkIndex,
          chunkTokenCount: r.tokenCount ?? null,
          qdrantPointId: r.qdrantPointId,
          embeddingModel: config.embeddingModel,
          parser: parser ?? null,
          status: "indexed",
        })),
      })
    }
  } catch (err) {
    console.warn(`recordIndexing: failed to record RagDocument tracking for contentId=${contentId} (Qdrant vectors were still written):`, err)
  }

  return results
}

/**
 * Same detection indexContent() itself uses to route to processAndIndexVideo
 * — shared so the /index route can decide sync-vs-async before calling in,
 * without the two ever drifting out of sync on what counts as "a video".
 */
export function isVideoContent(payload: Pick<RagIndexRequest, "sourceType" | "sourceUrl">): boolean {
  return payload.sourceType === "video" || Boolean(payload.sourceUrl && payload.sourceUrl.match(/\.(mp4|webm|mov|avi)/i))
}

/**
 * Ingests content into Qdrant across modalities (text, pdf, image, audio, video) using Groq & CLIP sidecar.
 */
export async function indexContent(payload: RagIndexRequest): Promise<IndexerChunkResult[]> {
  const { contentId, userId, sourceType, sourceUrl, sourceName, text: rawText, mode = "clip" } = payload

  // Every branch below (notes, images, PDFs, audio, video + its frames)
  // upserts fresh points under this same contentId with brand-new random
  // point IDs, never reusing or checking for old ones — so without this,
  // re-indexing on edit orphans every previous version's vectors in Qdrant:
  // invisible to Postgres tracking, but still live and citable. A no-op
  // filter match on first-ever indexing, real cleanup on every re-index.
  await deleteContentVectors(userId, contentId)

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
      const vector = await embedText(chunkTextContent, "RETRIEVAL_DOCUMENT")
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
    return recordIndexing(payload, indexedResults)
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

      return recordIndexing(payload, [
        {
          qdrantPointId: randomUUID(),
          chunkIndex: 0,
          text: `Indexed image via ${imgResult.mode} mode. Cloudinary: ${imgResult.cloudinaryUrl}`,
          tokenCount: 10,
        },
      ])
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
        const vector = await embedText(chunkTextContent, "RETRIEVAL_DOCUMENT")
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
      return recordIndexing(payload, indexedResults)
    }
  }

  // 4. Video Files (Audio transcript + Uniform CLIP frame sampling)
  if (isVideoContent({ sourceType, sourceUrl })) {
    if (sourceUrl) {
      const videoRes = await processAndIndexVideo({
        userId,
        contentId,
        sourceName,
        sourceUrl,
      })

      // Also index the note body/title as a text chunk for keyword searchability
      const bodyText = normalizeText((rawText ?? "").replace(/<[^>]+>/g, " "))
      if (bodyText) {
        const bodyChunks = chunkText(bodyText)
        for (let i = 0; i < bodyChunks.length; i++) {
          const chunkTextContent = bodyChunks[i].text
          const vector = await embedText(chunkTextContent, "RETRIEVAL_DOCUMENT")
          const pointId = randomUUID()
          await upsertChunk(pointId, vector, {
            contentId,
            userId,
            sourceType: "video",
            sourceUrl,
            sourceName,
            sourceTitle: sourceName,
            cloudinaryUrl,
            modality: "video_audio",
            chunkIndex: i,
            text: chunkTextContent,
          })
        }
      }

      return recordIndexing(payload, [
        {
          qdrantPointId: randomUUID(),
          chunkIndex: 0,
          text: `Indexed video: ${videoRes.indexedAudioChunks} audio chunks, ${videoRes.indexedFrames} frame vectors. Cloudinary: ${videoRes.cloudinaryUrl}`,
          tokenCount: 15,
        },
      ])
    }
    // No sourceUrl — fall through to index any body text below
  }

  // 5. Plain Text / Articles / Shared Notes / Messages
  const textContent = normalizeText((rawText ?? "").replace(/<[^>]+>/g, " "))
  if (!textContent) throw new Error("No indexable text content provided to index")

  const chunks = chunkText(textContent)
  const indexedResults: IndexerChunkResult[] = []

  for (let i = 0; i < chunks.length; i++) {
    const chunkObj = chunks[i]
    const chunkTextContent = chunkObj.text
    const vector = await embedText(chunkTextContent, "RETRIEVAL_DOCUMENT")
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

  return recordIndexing(payload, indexedResults)
}

/**
 * Performs parallel cross-modal RAG retrieval and answers user query with Groq LLM (config.groqLlmModel).
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
    embedText(query, "RETRIEVAL_QUERY"),
    embedTextClip(query).catch(() => [] as number[]),
  ])

  // Fetch more text hits so notes aren't buried behind image tag chunks
  const textTopK = Math.max(topK, 8)

  const [textHits, imageHits] = await Promise.all([
    searchSimilar(groqTextVector, userId, textTopK),
    clipTextVector.length ? searchSimilarImages(clipTextVector, userId, 3).catch(() => []) : Promise.resolve([]),
  ])

  // Distinct from "no relevant hits for THIS query" below — an empty library
  // reads as a confusing search failure otherwise. Checked against raw
  // retrieval (not RagDocument, which recordIndexing writes best-effort and
  // can silently fail to track — e.g. on a content/user row that doesn't
  // exist in Postgres — while the Qdrant vectors themselves are still very
  // real and searchable). Qdrant's kNN search returns hits regardless of
  // similarity score as long as any point exists for this userId, so zero
  // raw hits in both collections means zero indexed content, full stop.
  if (textHits.length === 0 && imageHits.length === 0) {
    return {
      answer: "You haven't added any notes, images, or files yet — add some content first, then ask me about it.",
      sources: [],
    }
  }

  const allTextHits: RAGSourceContext[] = textHits.map((h) => ({
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
    timestampSeconds: typeof h.payload?.timestampSeconds === "number" ? h.payload.timestampSeconds : null,
  }))

  // Split: real content (notes, audio, video, pdf) vs tag-description chunks
  // stored in rag_text. Image and video-frame tag chunks (modality "image" /
  // "video_frame") get the same, lower floor so they don't crowd out real
  // notes/audio when the query isn't about visual content.
  const noteHits = allTextHits.filter((h) =>
    (h.modality !== "image" && h.modality !== "video_frame") || h.score >= config.imageTagScoreThreshold
  )

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
    timestampSeconds: typeof h.payload?.timestampSeconds === "number" ? h.payload.timestampSeconds : null,
  }))

  const textCheck = noteHits.length >= 3
    ? validateContextRelevance(noteHits)
    : { hasSufficientContext: noteHits.length > 0, filteredSources: noteHits }

  // CLIP image hits come from the dedicated rag_images collection and are always included
  const imageCheck = formattedImageHits.length >= 3
    ? validateContextRelevance(formattedImageHits)
    : { hasSufficientContext: formattedImageHits.length > 0, filteredSources: formattedImageHits }

  // Symmetric relevance balancing:
  // If the top CLIP image score beats the top text score, the query is image-focused.
  // In that case, apply a stricter threshold to text hits to prevent low-relevance
  // audio/text chunks from appearing in image answers.
  const topTextScore = textCheck.filteredSources.length > 0
    ? Math.max(...textCheck.filteredSources.map((h) => h.score))
    : 0
  const topImageScore = imageCheck.filteredSources.length > 0
    ? Math.max(...imageCheck.filteredSources.map((h) => h.score))
    : 0

  const finalTextHits = topImageScore > topTextScore
    ? textCheck.filteredSources.filter((h) => h.score >= config.imageFocusedTextScoreThreshold)
    : textCheck.filteredSources

  // Merge: real content first, then CLIP image hits — both sorted by score desc
  const realContentSorted = finalTextHits.sort((a, b) => b.score - a.score)
  const clipImagesSorted = imageCheck.filteredSources.sort((a, b) => b.score - a.score)

  // Enforce a per-modality cap of max 3 hits in the final context
  const modalityCounts: Record<string, number> = {}
  const cappedHits = [...realContentSorted, ...clipImagesSorted].filter((h) => {
    const mod = h.modality || h.sourceType || "unknown"
    modalityCounts[mod] = (modalityCounts[mod] ?? 0) + 1
    return modalityCounts[mod] <= 3
  })

  // Minimum overall relevance gate: if every hit scores below
  // config.minOverallScore, nothing is truly relevant to this query.
  const bestScore = cappedHits.length > 0 ? Math.max(...cappedHits.map((h) => h.score)) : 0
  if (bestScore < config.minOverallScore) {
    return {
      answer: "I could not find sufficient context in your knowledge base to answer this question accurately.",
      sources: [],
    }
  }

  const systemPrompt = buildGroundedSystemPrompt(cappedHits)
  const answer = await generateGroqAnswer(systemPrompt, query)

  return {
    answer,
    sources: cappedHits,
  }
}

/**
 * Reindexes a user's content when it's missing from Qdrant/Postgres or was
 * indexed under a different embeddingModel than config.embeddingModel (e.g.
 * content indexed under the old hash-based fallback before Task 1). The
 * caller (apps/web) supplies the content list since it owns the Content
 * table — rag-backend only tracks RagDocument (what's already indexed).
 */
export async function reindexUserContent(
  userId: string,
  contents: RagReindexContentItem[] = [],
  force = false
): Promise<{
  scanned: number
  reindexed: number
  failed: number
  skipped: number
  results: Array<{ contentId: string; status: "reindexed" | "skipped" | "failed"; error?: string }>
}> {
  let reindexed = 0
  let failed = 0
  let skipped = 0
  const results: Array<{ contentId: string; status: "reindexed" | "skipped" | "failed"; error?: string }> = []

  for (const item of contents) {
    const existing = await prisma.ragDocument.findMany({
      where: { userId, contentId: item.contentId },
      select: { embeddingModel: true },
    })

    const isStale = existing.some((d) => d.embeddingModel !== config.embeddingModel)
    const needsReindex = force || existing.length === 0 || isStale

    if (!needsReindex) {
      skipped += 1
      results.push({ contentId: item.contentId, status: "skipped" })
      continue
    }

    try {
      await indexContent({
        contentId: item.contentId,
        userId,
        sourceType: item.sourceType,
        sourceUrl: item.sourceUrl ?? null,
        sourceName: item.sourceName ?? null,
        text: item.text ?? undefined,
      })
      reindexed += 1
      results.push({ contentId: item.contentId, status: "reindexed" })
    } catch (err) {
      failed += 1
      const message = err instanceof Error ? err.message : String(err)
      console.error(`reindexUserContent: failed to reindex ${item.contentId}:`, err)
      results.push({ contentId: item.contentId, status: "failed", error: message })
    }
  }

  return { scanned: contents.length, reindexed, failed, skipped, results }
}