import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { randomBytes } from "crypto"

// GET — share status for a note
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id }  = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const note = await prisma.content.findUnique({
    where: { id },
    select: { id: true, shareEnabled: true, shareHash: true, shareExpiresAt: true, authorId: true },
  })
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (note.authorId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
  const isExpired = note.shareExpiresAt ? new Date(note.shareExpiresAt) < new Date() : false

  return NextResponse.json({
    shareEnabled:  note.shareEnabled && !isExpired,
    shareHash:     note.shareHash,
    shareExpiresAt: note.shareExpiresAt,
    shareLink:     note.shareHash ? `${baseUrl}/share/${note.shareHash}` : null,
    isExpired,
  })
}

// POST — enable sharing with duration
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id }  = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const note = await prisma.content.findUnique({ where: { id } })
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (note.authorId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { duration, days } = await req.json() as { duration: "1h" | "1d" | "custom"; days?: number }

  // Calculate expiry
  const now = new Date()
  let expiresAt: Date

  if (duration === "1h") {
    expiresAt = new Date(now.getTime() + 60 * 60 * 1000)
  } else if (duration === "1d") {
    expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  } else if (duration === "custom" && days && days > 0) {
    expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  } else {
    return NextResponse.json({ error: "Invalid duration. Use '1h', '1d', or 'custom' with days." }, { status: 400 })
  }

  // Reuse existing hash or generate new
  const shareHash = note.shareHash ?? randomBytes(12).toString("hex")
  const baseUrl   = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"

  const updated = await prisma.content.update({
    where: { id },
    data:  { shareEnabled: true, shareHash, shareExpiresAt: expiresAt },
    select: { id: true, shareEnabled: true, shareHash: true, shareExpiresAt: true },
  })

  return NextResponse.json({
    message:        "Sharing enabled",
    shareEnabled:   updated.shareEnabled,
    shareHash:      updated.shareHash,
    shareExpiresAt: updated.shareExpiresAt,
    shareLink:      `${baseUrl}/share/${updated.shareHash}`,
  }, { status: 201 })
}

// DELETE — disable sharing
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id }  = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const note = await prisma.content.findUnique({ where: { id } })
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (note.authorId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  await prisma.content.update({
    where: { id },
    data:  { shareEnabled: false, shareHash: null, shareExpiresAt: null },
  })

  return NextResponse.json({ message: "Sharing disabled" })
}
