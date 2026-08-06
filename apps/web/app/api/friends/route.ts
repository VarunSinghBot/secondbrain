import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const friendships = await prisma.friendship.findMany({
    where: { userId: session.user.id },
    include: { friend: { select: { id: true, name: true, username: true, email: true, image: true } } },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(friendships.map((f) => f.friend))
}
