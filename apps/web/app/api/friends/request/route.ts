import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 })
  if (email === session.user.email) return NextResponse.json({ error: "Cannot add yourself" }, { status: 400 })

  const receiver = await prisma.user.findUnique({ where: { email } })
  if (!receiver) return NextResponse.json({ error: "User not found" }, { status: 404 })

  // Check if already friends
  const existing = await prisma.friendship.findUnique({
    where: { userId_friendId: { userId: session.user.id, friendId: receiver.id } },
  })
  if (existing) return NextResponse.json({ error: "Already friends" }, { status: 400 })

  // Check if request already sent
  const existingReq = await prisma.friendRequest.findUnique({
    where: { senderId_receiverId: { senderId: session.user.id, receiverId: receiver.id } },
  })
  if (existingReq) return NextResponse.json({ error: "Request already sent" }, { status: 400 })

  const request = await prisma.friendRequest.create({
    data: { senderId: session.user.id, receiverId: receiver.id },
    include: { receiver: { select: { name: true, email: true } } },
  })

  return NextResponse.json({ message: "Friend request sent", request }, { status: 201 })
}
