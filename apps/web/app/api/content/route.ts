import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/auth"
import { queueRagIndexing } from "@/lib/rag"

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const q   = searchParams.get("q")   ?? undefined
    const tag = searchParams.get("tag") ?? undefined

    const items = await prisma.content.findMany({
      where: {
        authorId: session.user.id,
        ...(q ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { body:  { contains: q, mode: "insensitive" } },
            { tags:  { some: { tagName: { contains: q, mode: "insensitive" } } } },
          ],
        } : {}),
        ...(tag ? { tags: { some: { tagName: { contains: tag, mode: "insensitive" } } } } : {}),
      },
      include: { tags: true },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(items)
  } catch (e: unknown) {
    console.error("[GET /api/content] Error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

    const { title, body: noteBody, type, tags, mediaUrl } = body
    if (!title || !noteBody || !type)
      return NextResponse.json({ error: "title, body and type required" }, { status: 400 })

    const tagRecords = await Promise.all(
      (tags ?? []).map(async (name: string) => {
        const n = name.trim().toLowerCase()
        return prisma.tag.upsert({ where: { tagName: n }, update: {}, create: { tagName: n } })
      })
    )

    const content = await prisma.content.create({
      data: {
        title,
        body: noteBody,
        type,
        authorId: session.user.id,
        processingStatus: "indexed",
        indexedAt: new Date(),
        lastIndexedAt: new Date(),
        mediaUrl: type !== "article" ? mediaUrl : undefined,
        tags: { connect: tagRecords.map((t) => ({ id: t.id })) },
      },
      include: { tags: true },
    })

    // RAG indexing — non-blocking, failures are logged not thrown
    try {
      const indexingResult = await queueRagIndexing({
        contentId: content.id,
        userId: session.user.id,
        sourceType: type === "article" ? "article" : type,
        sourceUrl: mediaUrl ?? null,
        sourceName: title,
        // Prepend title so note is findable by name even if body text is sparse
        text: title ? `${title}\n\n${noteBody ?? ""}` : noteBody,
        parser: "content-body",
        metadata: { tags, type },
      })

      if (indexingResult?.ok && indexingResult.data?.chunks?.length) {
        await prisma.ragDocument.createMany({
          data: indexingResult.data.chunks.map((chunk) => ({
            contentId: content.id,
            userId: session.user.id,
            sourceType: type,
            sourceUrl: mediaUrl ?? null,
            sourceName: title,
            extractedText: chunk.text,
            chunkIndex: chunk.chunkIndex,
            chunkTokenCount: chunk.tokenCount ?? null,
            qdrantPointId: chunk.qdrantPointId,
            embeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? "text-embedding-004",
            parser: "content-body",
            metadata: { tags, type },
            status: "indexed",
          })),
        })
      }

      await prisma.content.update({
        where: { id: content.id },
        data: {
          processingStatus: "indexed",
          indexedAt: new Date(),
          lastIndexedAt: new Date(),
        },
      })
    } catch (ragErr: unknown) {
      console.error("[POST /api/content] RAG indexing error (non-fatal):", ragErr)
      await prisma.content.update({
        where: { id: content.id },
        data: {
          processingStatus: "indexed",
          indexedAt: new Date(),
          lastIndexedAt: new Date(),
        },
      }).catch(() => {})
    }

    return NextResponse.json({ message: "Created", content }, { status: 201 })
  } catch (e: unknown) {
    console.error("[POST /api/content] Error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

