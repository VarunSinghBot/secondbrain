import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"

export async function GET(_: NextRequest, { params }: { params: Promise<{ friendId: string }> }) {
  const { friendId } = await params
  const session      = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { senderId: session.user.id, receiverId: friendId },
        { senderId: friendId,        receiverId: session.user.id },
      ],
    },
    include: { sender: { select: { id: true, name: true, username: true, image: true } } },
    orderBy: { createdAt: "asc" },
    take: 100,
  })

  // Mark messages as read
  await prisma.message.updateMany({
    where: { senderId: friendId, receiverId: session.user.id, read: false },
    data:  { read: true },
  })

  return NextResponse.json(messages)
}
