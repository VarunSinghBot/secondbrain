import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const shares = await prisma.noteShare.findMany({
      where:   { sharedWithId: session.user.id },
      include: {
        note:     { include: { tags: true } },
        sharedBy: { select: { id: true, name: true, username: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    })

    const result = shares.map((s) => ({ ...s.note, sharedBy: s.sharedBy }))
    return NextResponse.json(result)
  } catch (e: unknown) {
    console.error("[GET /api/shared] Error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

