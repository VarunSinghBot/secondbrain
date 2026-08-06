import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id }  = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const comments = await prisma.comment.findMany({
    where:   { noteId: id },
    include: { author: { select: { id: true, name: true, username: true, image: true } } },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(comments)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id }  = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { content } = await req.json()
  if (!content?.trim()) return NextResponse.json({ error: "Content required" }, { status: 400 })

  const comment = await prisma.comment.create({
    data:    { noteId: id, authorId: session.user.id, content },
    include: { author: { select: { id: true, name: true, username: true, image: true } } },
  })

  return NextResponse.json(comment, { status: 201 })
}
