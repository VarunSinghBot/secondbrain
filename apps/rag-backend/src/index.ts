import cors from "cors"
import dotenv from "dotenv"
import express, { Request, Response } from "express"

import type { RagAskRequest, RagAskResponse, RagIndexRequest, RagReindexBatchRequest, RagReindexBatchResponse, RagVerifyRequest, RagVerifyResponse } from "@secondbrain/types"

import { askWithRag, indexContent, reindexUserContent } from "./services/indexer"
import { addJob, getJob, startWorker } from "./worker/queue"
import { embedText } from "./lib/embeddings"
import { ClipSidecarUnavailableError, embedTextClip } from "./lib/clip-client"
import { searchSimilar, searchSimilarImages } from "./lib/qdrant"
import { generateGroqAnswer } from "./lib/groq"
import { buildGroundedSystemPrompt, validateUserQuery } from "./lib/guardrails"

dotenv.config()

const app = express()
const port = process.env.RAG_BACKEND_PORT ? Number(process.env.RAG_BACKEND_PORT) : 3000

app.use(cors())
app.use(express.json({ limit: "25mb" }))

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "rag-backend" })
})

app.post("/index", async (req: Request<unknown, unknown, RagIndexRequest>, res: Response) => {
  const payload = req.body

  if (!payload?.contentId || !payload.userId || !payload.sourceType) {
    return res.status(400).json({ error: "contentId, userId and sourceType are required" })
  }

  try {
    const chunks = await indexContent(payload)
    return res.status(201).json({
      message: "Indexed",
      contentId: payload.contentId,
      userId: payload.userId,
      chunksIndexed: chunks.length,
      chunkIds: chunks.map((chunk) => chunk.qdrantPointId),
      chunks: chunks.map((chunk) => ({
        qdrantPointId: chunk.qdrantPointId,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
      })),
    })
  } catch (error) {
    if (error instanceof ClipSidecarUnavailableError) {
      return res.status(503).json({ error: error.message })
    }
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Indexing failed",
    })
  }
})

app.post("/reindex", async (req: Request<unknown, unknown, RagReindexBatchRequest>, res: Response<RagReindexBatchResponse | { error: string }>) => {
  const { userId, contents, force = false } = req.body ?? {}

  if (!userId || !Array.isArray(contents)) {
    return res.status(400).json({ error: "userId and contents[] are required" })
  }

  try {
    const result = await reindexUserContent(userId, contents, force)
    return res.json(result)
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Reindex failed" })
  }
})

app.post("/ask", async (req: Request<unknown, unknown, RagAskRequest>, res: Response<RagAskResponse | { error: string }>) => {
  const payload = req.body

  if (!payload?.query || !payload.userId) {
    return res.status(400).json({ error: "query and userId are required" })
  }

  try {
    const { answer, sources } = await askWithRag(payload.userId, payload.query, payload.topK ?? 5)

    return res.json({
      answer,
      citations: sources.map((source) => ({
        contentId: source.contentId,
        title: source.sourceName,
        sourceTitle: (source as any).sourceTitle || source.sourceName,
        sourceType: source.sourceType as RagAskResponse["citations"][number]["sourceType"],
        modality: source.modality || source.sourceType || "text",
        sourceUrl: source.sourceUrl || source.cloudinaryUrl,
        cloudinaryUrl: source.cloudinaryUrl,
        chunkIndex: source.chunkIndex ?? 0,
        score: source.score,
      })),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Ask failed"
    const isValidationError = /injection|restricted|invalid|guardrail/i.test(msg)
    return res.status(isValidationError ? 400 : 500).json({ error: msg })
  }
})

function computeGroundingVerdict(answer: string, hits: Array<{ textPreview?: string; text?: string; caption?: string; tags?: string[] }>): string {
  if (!hits.length) {
    return "❌ No hits retrieved — nothing was ingested for this modality yet."
  }

  const answerLower = answer.toLowerCase()
  for (const h of hits) {
    const contentText = h.textPreview || h.text || h.caption || (h.tags ? h.tags.join(" ") : "")
    const words = contentText.toLowerCase().split(/\s+/).filter((w) => w.length > 4)
    if (words.some((word) => answerLower.includes(word))) {
      return "✅ Answer is grounded in retrieved context."
    }
  }

  return "⚠️ Answer generated but overlap with context is low — check ingestion."
}

app.post("/verify", async (req: Request<unknown, unknown, RagVerifyRequest>, res: Response<RagVerifyResponse | { error: string }>) => {
  const { question, userId, modalityFilter, topK = 5 } = req.body ?? {}

  if (!question || !userId) {
    return res.status(400).json({ error: "question and userId are required" })
  }

  const queryCheck = validateUserQuery(question)
  if (!queryCheck.valid) {
    return res.status(400).json({ error: queryCheck.reason ?? "Invalid query" })
  }

  try {
    const [groqTextVec, clipTextVec] = await Promise.all([
      embedText(question, "RETRIEVAL_QUERY"),
      embedTextClip(question).catch(() => [] as number[]),
    ])

    const [rawTextHits, rawImageHits] = await Promise.all([
      searchSimilar(groqTextVec, userId, topK),
      clipTextVec.length ? searchSimilarImages(clipTextVec, userId, 3).catch(() => []) : Promise.resolve([]),
    ])

    const textHits = rawTextHits
      .map((h) => ({
        modality: String(h.payload?.modality ?? "text"),
        score: h.score,
        cloudinaryUrl: (h.payload?.cloudinaryUrl as string) || (h.payload?.sourceUrl as string) || undefined,
        textPreview: String(h.payload?.text ?? "").slice(0, 120),
        tags: Array.isArray(h.payload?.tags) ? (h.payload.tags as string[]) : undefined,
      }))
      .filter((h) => !modalityFilter || h.modality === modalityFilter)

    const imageHits = rawImageHits
      .map((h) => ({
        modality: "image",
        score: h.score,
        cloudinaryUrl: (h.payload?.cloudinaryUrl as string) || (h.payload?.sourceUrl as string) || undefined,
        textPreview: String(h.payload?.caption ?? h.payload?.text ?? "").slice(0, 120),
        tags: Array.isArray(h.payload?.tags) ? (h.payload.tags as string[]) : undefined,
      }))
      .filter(() => !modalityFilter || modalityFilter === "image")

    const retrievedHits = [...textHits, ...imageHits]

    const sourcesForPrompt = retrievedHits.map((h, i) => ({
      index: i + 1,
      contentId: `verify-${i}`,
      sourceType: h.modality,
      cloudinaryUrl: h.cloudinaryUrl,
      text: h.textPreview,
      score: h.score,
    }))

    const systemPrompt = buildGroundedSystemPrompt(sourcesForPrompt)
    const answer = await generateGroqAnswer(systemPrompt, question)
    const verdict = computeGroundingVerdict(answer, retrievedHits)

    return res.json({
      question,
      label: `VERIFY (${modalityFilter || "all"}) ${question}`,
      retrievedHits,
      answer,
      verdict,
    })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Verification failed" })
  }
})

app.post("/delete", async (req: Request, res: Response) => {
  const { userId, contentId } = req.body ?? {}

  if (!userId || !contentId) {
    return res.status(400).json({ error: "userId and contentId are required" })
  }

  try {
    const { deleteContentVectors } = await import("./lib/qdrant")
    await deleteContentVectors(userId, contentId)
    return res.json({ message: "Deleted", userId, contentId })
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Delete failed",
    })
  }
})

app.post("/ingest-async", async (req: Request<unknown, unknown, RagIndexRequest>, res: Response) => {
  const payload = req.body

  if (!payload?.contentId || !payload.userId || !payload.sourceType) {
    return res.status(400).json({ error: "contentId, userId and sourceType are required" })
  }

  try {
    const jobId = await addJob(payload)
    return res.status(202).json({ jobId, status: "queued" })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to enqueue job" })
  }
})

app.get("/ingest-async/:jobId", async (req: Request, res: Response) => {
  const rawJobId = req.params.jobId
  const jobId = Array.isArray(rawJobId) ? rawJobId[0] : rawJobId
  if (!jobId) return res.status(400).json({ error: "jobId is required" })

  const job = await getJob(jobId)
  if (!job) return res.status(404).json({ error: "job not found" })
  return res.json(job)
})

app.post("/admin/reset-collections", async (req: Request, res: Response) => {
  const adminSecret = req.headers["x-admin-secret"]
  const expectedSecret = process.env.ADMIN_SECRET
  if (!expectedSecret || adminSecret !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  try {
    const { resetCollections } = await import("./lib/admin")
    await resetCollections()
    return res.json({ success: true, message: "Collections reset. Re-ingest all content." })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Reset failed" })
  }
})

app.get("/admin/inspect", async (req: Request, res: Response) => {
  const adminSecret = req.headers["x-admin-secret"]
  const expectedSecret = process.env.ADMIN_SECRET
  if (!expectedSecret || adminSecret !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  const userId = req.query.userId as string
  const modality = req.query.modality as string

  if (!userId) {
    return res.status(400).json({ error: "userId is required" })
  }

  try {
    const { qdrantRequest } = await import("./lib/qdrant")
    const { config } = await import("./lib/config")

    const inspectCollection = async (collectionName: string) => {
      const mustFilter: any[] = [{ key: "userId", match: { value: userId } }]
      if (modality) {
        mustFilter.push({ key: "modality", match: { value: modality } })
      }

      const response = await qdrantRequest(`/collections/${collectionName}/points/scroll`, {
        method: "POST",
        body: JSON.stringify({
          filter: { must: mustFilter },
          limit: 100,
          with_payload: true,
          with_vector: false
        })
      })

      if (!response.ok) {
        throw new Error(`Qdrant scroll failed for '${collectionName}': ${response.statusText}`)
      }

      const data = await response.json() as { result?: { points?: any[] } }
      const points = data.result?.points ?? []

      return {
        collection: collectionName,
        totalFound: points.length,
        points: points.map((p: any) => ({
          id: String(p.id),
          modality: String(p.payload?.modality ?? ""),
          preview: String(p.payload?.text ?? p.payload?.caption ?? "").slice(0, 80),
          cloudinary_url: String(p.payload?.cloudinaryUrl ?? p.payload?.sourceUrl ?? ""),
          chunkIndex: Number(p.payload?.chunkIndex ?? 0),
          contentId: String(p.payload?.contentId ?? "")
        }))
      }
    }

    const [textResults, imageResults] = await Promise.all([
      inspectCollection(config.qdrantCollection),
      inspectCollection(config.qdrantImageCollection)
    ])

    return res.json({
      textResults,
      imageResults
    })
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Inspect failed" })
  }
})

app.listen(port, () => {
  console.log(`Multimodal RAG backend (Groq + CLIP) running on port ${port}`)
})

startWorker().catch((err) => console.error("Worker failed to start:", err))