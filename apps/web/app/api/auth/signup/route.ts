import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import bcrypt from "bcrypt"

export async function POST(req: NextRequest) {
  const { email, password, username } = await req.json()
  if (!email || !password || !username)
    return NextResponse.json({ error: "All fields required" }, { status: 400 })

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return NextResponse.json({ error: "User already exists" }, { status: 400 })

  const hashed = await bcrypt.hash(password, 10)
  const user   = await prisma.user.create({ data: { email, password: hashed, username, name: username } })
  return NextResponse.json({ message: "User created", userId: user.id }, { status: 201 })
}
