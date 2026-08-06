import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"

// GET — all notes with sharing currently enabled for this user
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const notes = await prisma.content.findMany({
    where: { authorId: session.user.id, shareEnabled: true },
    include: { tags: true },
    orderBy: { updatedAt: "desc" },
  })

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
  const now     = new Date()

  const result = notes.map((note) => {
    const isExpired = note.shareExpiresAt ? new Date(note.shareExpiresAt) < now : false
    return {
      ...note,
      shareLink: note.shareHash ? `${baseUrl}/share/${note.shareHash}` : null,
      isExpired,
    }
  })

  return NextResponse.json(result)
}
