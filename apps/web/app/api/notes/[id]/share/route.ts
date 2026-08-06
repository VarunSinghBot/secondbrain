import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { randomBytes } from "crypto"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id }  = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const note = await prisma.content.findUnique({ where: { id } })
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (note.authorId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { type, friendId } = await req.json()

  if (type === "public") {
    const hash    = randomBytes(16).toString("hex")
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
    const link    = await prisma.link.create({ data: { hash, authorId: session.user.id } })
    return NextResponse.json({ shareLink: `${baseUrl}/share/${link.hash}` }, { status: 201 })
  }

  if (type === "friend") {
    if (!friendId) return NextResponse.json({ error: "friendId required" }, { status: 400 })
    const share = await prisma.noteShare.upsert({
      where:  { noteId_sharedWithId: { noteId: id, sharedWithId: friendId } },
      update: {},
      create: { noteId: id, sharedById: session.user.id, sharedWithId: friendId },
    })
    return NextResponse.json({ message: "Note shared with friend", share }, { status: 201 })
  }

  return NextResponse.json({ error: "Invalid type" }, { status: 400 })
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id }  = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const shares = await prisma.noteShare.findMany({
    where:   { noteId: id },
    include: { sharedWith: { select: { id: true, name: true, email: true, image: true } } },
  })

  return NextResponse.json(shares)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id }  = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { friendId } = await req.json()
  await prisma.noteShare.deleteMany({
    where: { noteId: id, sharedById: session.user.id, sharedWithId: friendId },
  })

  return NextResponse.json({ message: "Share removed" })
}