import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { receiverId, content } = await req.json()
  if (!receiverId || !content) return NextResponse.json({ error: "receiverId and content required" }, { status: 400 })

  const message = await prisma.message.create({
    data: { senderId: session.user.id, receiverId, content },
    include: { sender: { select: { id: true, name: true, username: true, image: true } } },
  })

  return NextResponse.json(message, { status: 201 })
}
