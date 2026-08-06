import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const tags = await prisma.tag.findMany({ orderBy: { tagName: "asc" } });
  return NextResponse.json(tags);
}

export async function POST(req: NextRequest) {
  const { tagName } = await req.json();
  if (!tagName) return NextResponse.json({ error: "tagName required" }, { status: 400 });
  const name = tagName.trim().toLowerCase();
  const existing = await prisma.tag.findUnique({ where: { tagName: name } });
  if (existing) return NextResponse.json({ error: "Tag already exists" }, { status: 400 });
  const tag = await prisma.tag.create({ data: { tagName: name } });
  return NextResponse.json({ message: "Tag created", tag }, { status: 201 });
}
