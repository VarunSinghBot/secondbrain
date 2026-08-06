import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id }  = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { action } = await req.json() // "accept" | "reject"

  const request = await prisma.friendRequest.findUnique({ where: { id } })
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (request.receiverId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  if (action === "accept") {
    await prisma.$transaction([
      prisma.friendRequest.update({ where: { id }, data: { status: "accepted" } }),
      // Create friendship both ways
      prisma.friendship.createMany({
        data: [
          { userId: session.user.id,  friendId: request.senderId },
          { userId: request.senderId, friendId: session.user.id  },
        ],
        skipDuplicates: true,
      }),
    ])
    return NextResponse.json({ message: "Friend request accepted" })
  } else {
    await prisma.friendRequest.update({ where: { id }, data: { status: "rejected" } })
    return NextResponse.json({ message: "Friend request rejected" })
  }
}
