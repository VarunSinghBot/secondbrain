import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/auth"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { theme: true, layout: true, image: true, name: true, email: true },
  })
  return NextResponse.json(user)
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { theme, layout, image, name } = await req.json()
  const data: Record<string, string> = {}
  if (theme) data.theme = theme
  if (layout) data.layout = layout
  if (typeof image === "string") data.image = image
  if (typeof name === "string") data.name = name

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: { theme: true, layout: true, image: true, name: true, email: true },
  })
  return NextResponse.json(user)
}

