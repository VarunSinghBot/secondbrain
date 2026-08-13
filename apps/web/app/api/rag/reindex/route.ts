import { NextRequest, NextResponse } from "next/server"

import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { queueRagIndexing } from "@/lib/rag"
import type { RagReindexRequest, RagReindexResponse } from "@secondbrain/types"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<RagReindexRequest>
  const force = body.force ?? false

  const contents = await prisma.content.findMany({
    where: { authorId: session.user.id },
    include: { tags: true, ragDocuments: true },
    orderBy: { createdAt: "asc" },
  })

  let reindexed = 0
  let failed = 0
  let skipped = 0

  for (const content of contents) {
    if (!force && content.ragDocuments.length > 0) {
      skipped += 1
      continue
    }

    const indexingResult = await queueRagIndexing({
      contentId: content.id,
      userId: session.user.id,
      sourceType: (content.type as any) ?? "article",
      sourceUrl: content.mediaUrl ?? null,
      sourceName: content.title,
      text: content.body,
      parser: "content-body",
      metadata: {
        tags: content.tags.map((tag) => tag.tagName),
        type: content.type,
        alreadyIndexed: content.ragDocuments.length > 0,
      },
    })

    if (indexingResult?.ok && indexingResult.data?.chunks?.length) {
      reindexed += 1

      await prisma.ragDocument.deleteMany({ where: { contentId: content.id } })
      await prisma.ragDocument.createMany({
        data: indexingResult.data.chunks.map((chunk) => ({
          contentId: content.id,
          userId: session.user.id,
          sourceType: content.type,
          sourceUrl: content.mediaUrl ?? null,
          sourceName: content.title,
          extractedText: chunk.text,
          chunkIndex: chunk.chunkIndex,
          chunkTokenCount: chunk.tokenCount ?? null,
          qdrantPointId: chunk.qdrantPointId,
          embeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? "text-embedding-004",
          parser: "content-body",
          metadata: { tags: content.tags.map((tag) => tag.tagName), type: content.type },
          status: "indexed",
        })),
      })

      await prisma.content.update({
        where: { id: content.id },
        data: {
          processingStatus: "indexed",
          indexedAt: new Date(),
          lastIndexedAt: new Date(),
        },
      })
    } else {
      failed += 1
      await prisma.content.update({
        where: { id: content.id },
        data: { processingStatus: "failed" },
      })
    }
  }

  const response: RagReindexResponse = {
    message: force ? "Forced reindex completed" : "Reindex completed",
    scanned: contents.length,
    reindexed,
    failed,
    skipped,
  }

  return NextResponse.json(response)
}