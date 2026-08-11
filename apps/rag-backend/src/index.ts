import cors from "cors"
import dotenv from "dotenv"
import express, { Request, Response } from "express"

import type { RagAskRequest, RagAskResponse, RagIndexRequest } from "@secondbrain/types"

import { askWithRag, indexContent } from "./services/indexer"
import { addJob, getJob, startWorker } from "./worker/queue"

dotenv.config()

const app = express()
const port = process.env.RAG_BACKEND_PORT ? Number(process.env.RAG_BACKEND_PORT) : 8090

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
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Indexing failed",
    })
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
        sourceType: source.sourceType as RagAskResponse["citations"][number]["sourceType"],
        sourceUrl: source.sourceUrl,
        chunkIndex: source.chunkIndex,
        score: source.score,
      })),
    })
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Ask failed",
    })
  }
})

app.listen(port, () => {
  console.log(`SecondBrain RAG backend running on port ${port}`)
})

// Enqueue an async ingestion job (returns job id)
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

// start background worker to process queued ingest jobs
startWorker().catch((err) => console.error("Worker failed to start:", err))