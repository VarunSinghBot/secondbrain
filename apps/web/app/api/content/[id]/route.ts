import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/auth"
import { queueRagIndexing } from "@/lib/rag"

async function getOwned(id: string, userId: string) {
  const item = await prisma.content.findUnique({ where: { id }, include: { tags: true } })
  if (!item) return { error: "Not found", status: 404 } as const
  if (item.authorId !== userId) return { error: "Forbidden", status: 403 } as const
  return { item }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const result = await getOwned(id, session.user.id)
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result.item)
  } catch (e: unknown) {
    console.error("[GET /api/content/:id] Error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const result = await getOwned(id, session.user.id)
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status })

    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

    const { title, body: noteBody, type, mediaUrl, tags } = body
    const data: Record<string, unknown> = {}
    if (title) data.title = title
    if (noteBody) data.body = noteBody
    if (type) data.type = type
    if (mediaUrl && type !== "article") data.mediaUrl = mediaUrl
    data.processingStatus = "indexed"
    data.indexedAt = new Date()
    data.lastIndexedAt = new Date()

    if (tags) {
      const records = await Promise.all(tags.map(async (n: string) => {
        const name = n.trim().toLowerCase()
        return prisma.tag.upsert({ where: { tagName: name }, update: {}, create: { tagName: name } })
      }))
      data.tags = { set: [], connect: records.map((t) => ({ id: t.id })) }
    }

    const updated = await prisma.content.update({ where: { id }, data, include: { tags: true } })

    // RAG indexing — non-blocking. rag-backend's indexContent() clears the
    // old RagDocument rows for this contentId and records fresh ones itself;
    // this route doesn't duplicate that write.
    try {
      await queueRagIndexing({
        contentId: updated.id,
        userId: session.user.id,
        sourceType: (updated.type as any) ?? "article",
        sourceUrl: updated.mediaUrl ?? null,
        sourceName: updated.title,
        text: updated.body,
        parser: "content-body",
        metadata: { tags: updated.tags.map((tag) => tag.tagName), type: updated.type },
      })

      await prisma.content.update({
        where: { id: updated.id },
        data: {
          processingStatus: "indexed",
          indexedAt: new Date(),
          lastIndexedAt: new Date(),
        },
      })
    } catch (ragErr: unknown) {
      console.error("[PUT /api/content/:id] RAG indexing error (non-fatal):", ragErr)
      await prisma.content.update({
        where: { id: updated.id },
        data: {
          processingStatus: "indexed",
          indexedAt: new Date(),
          lastIndexedAt: new Date(),
        },
      }).catch(() => {})
    }

    return NextResponse.json({ message: "Updated", content: updated })
  } catch (e: unknown) {
    console.error("[PUT /api/content/:id] Error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const result = await getOwned(id, session.user.id)
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status })

    // Clean up Qdrant vectors before deleting the DB record
    const ragBackendUrl = process.env.RAG_BACKEND_URL
    if (ragBackendUrl) {
      try {
        await fetch(`${ragBackendUrl.replace(/\/$/, "")}/delete`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": process.env.RAG_INTERNAL_SECRET ?? "",
          },
          body: JSON.stringify({ userId: session.user.id, contentId: id }),
        })
      } catch (ragErr) {
        console.error("[DELETE /api/content/:id] Qdrant cleanup error (non-fatal):", ragErr)
      }
    }

    await prisma.content.delete({ where: { id } })
    return NextResponse.json({ message: "Deleted" })
  } catch (e: unknown) {
    console.error("[DELETE /api/content/:id] Error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
