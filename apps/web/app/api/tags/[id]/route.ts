import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tagName } = await req.json();
  const tag = await prisma.tag.update({ where: { id }, data: { tagName } });
  return NextResponse.json({ message: "Updated", tag });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.tag.delete({ where: { id } });
  return NextResponse.json({ message: "Deleted" });
}
