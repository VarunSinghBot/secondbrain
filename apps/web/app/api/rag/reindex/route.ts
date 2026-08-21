import { NextRequest, NextResponse } from "next/server"

import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import type { RagReindexBatchRequest, RagReindexBatchResponse, RagReindexRequest, RagReindexResponse } from "@secondbrain/types"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<RagReindexRequest>
  const force = body.force ?? false

  const ragBackendUrl = process.env.RAG_BACKEND_URL
  if (!ragBackendUrl) {
    return NextResponse.json({ error: "RAG_BACKEND_URL is not configured" }, { status: 500 })
  }

  const contents = await prisma.content.findMany({
    where: { authorId: session.user.id },
    orderBy: { createdAt: "asc" },
  })

  // rag-backend owns the reindex decision (RagDocument.embeddingModel vs its
  // current config.embeddingModel) since it owns that table — this route is
  // just a thin proxy so it doesn't duplicate that logic against a second,
  // easily-stale copy of the "is this indexed under the current model" check.
  const batchRequest: RagReindexBatchRequest = {
    userId: session.user.id,
    force,
    contents: contents.map((content) => ({
      contentId: content.id,
      sourceType: (content.type as RagReindexBatchRequest["contents"][number]["sourceType"]) ?? "article",
      sourceUrl: content.mediaUrl ?? null,
      sourceName: content.title,
      // Prepend title so notes are searchable by name even with sparse body text
      text: content.title ? `${content.title}\n\n${content.body ?? ""}` : content.body,
    })),
  }

  const ragResponse = await fetch(`${ragBackendUrl.replace(/\/$/, "")}/reindex`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.RAG_INTERNAL_SECRET ?? "",
    },
    body: JSON.stringify(batchRequest),
  })

  const ragResult = (await ragResponse.json().catch(() => null)) as RagReindexBatchResponse | { error?: string } | null
  if (!ragResponse.ok || !ragResult || !("results" in ragResult)) {
    const message = ragResult && "error" in ragResult ? ragResult.error : `rag-backend returned ${ragResponse.status}`
    return NextResponse.json({ error: message ?? "Reindex failed" }, { status: 502 })
  }

  const reindexedIds = ragResult.results.filter((r) => r.status === "reindexed").map((r) => r.contentId)
  const failedIds = ragResult.results.filter((r) => r.status === "failed").map((r) => r.contentId)

  if (reindexedIds.length > 0) {
    await prisma.content.updateMany({
      where: { id: { in: reindexedIds } },
      data: { processingStatus: "indexed", indexedAt: new Date(), lastIndexedAt: new Date() },
    })
  }
  if (failedIds.length > 0) {
    await prisma.content.updateMany({
      where: { id: { in: failedIds } },
      data: { processingStatus: "failed" },
    })
  }

  const response: RagReindexResponse = {
    message: force ? "Forced reindex completed" : "Reindex completed",
    scanned: ragResult.scanned,
    reindexed: ragResult.reindexed,
    failed: ragResult.failed,
    skipped: ragResult.skipped,
  }

  return NextResponse.json(response)
}
