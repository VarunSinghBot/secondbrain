import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/auth"

export async function GET(_: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params
  const link = await prisma.link.findUnique({
    where: { hash },
    include: { author: { include: { Content: true } } },
  })
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(link.author.Content)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const link = await prisma.link.findUnique({ where: { hash } })
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (link.authorId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  await prisma.link.delete({ where: { hash } })
  return NextResponse.json({ message: "Deleted" })
}