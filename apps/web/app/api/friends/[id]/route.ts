import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id }  = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  await prisma.friendship.deleteMany({
    where: {
      OR: [
        { userId: session.user.id, friendId: id },
        { userId: id, friendId: session.user.id },
      ],
    },
  })

  return NextResponse.json({ message: "Friend removed" })
}
