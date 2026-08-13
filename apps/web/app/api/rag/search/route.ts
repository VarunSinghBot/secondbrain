import { NextRequest, NextResponse } from "next/server"

import { auth } from "@/auth"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const backendUrl = process.env.RAG_BACKEND_URL
  if (!backendUrl) {
    return NextResponse.json({ results: [] })
  }

  const body = await req.json().catch(() => null)
  if (!body?.query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 })
  }

  try {
    const response = await fetch(`${backendUrl.replace(/\/$/, "")}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: body.query,
        userId: session.user.id,
        topK: body.topK ?? 10,
      }),
    })

    if (!response.ok) {
      return NextResponse.json({ results: [] })
    }

    const data = await response.json()
    const results = (data.citations ?? []).map((c: any) => ({
      contentId: c.contentId,
      title: c.title,
      sourceTitle: c.sourceTitle,
      sourceType: c.sourceType,
      modality: c.modality,
      score: c.score,
    }))

    return NextResponse.json({ results })
  } catch {
    return NextResponse.json({ results: [] })
  }
}
