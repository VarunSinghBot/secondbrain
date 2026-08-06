import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/auth"
import { randomBytes } from "crypto"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const hash    = randomBytes(16).toString("hex")
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
  const link    = await prisma.link.create({ data: { hash, authorId: session.user.id } })
  const shareLink = `${baseUrl}/share/${link.hash}`

  return NextResponse.json({ message: "Link created", link, shareLink }, { status: 201 })
}
