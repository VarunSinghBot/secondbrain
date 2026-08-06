import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const requests = await prisma.friendRequest.findMany({
    where: { receiverId: session.user.id, status: "pending" },
    include: { sender: { select: { id: true, name: true, username: true, email: true, image: true } } },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(requests)
}
