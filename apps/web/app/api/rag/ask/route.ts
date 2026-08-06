import { NextRequest, NextResponse } from "next/server"

import { auth } from "@/auth"
import type { RagAskRequest, RagAskResponse } from "@secondbrain/types"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const backendUrl = process.env.RAG_BACKEND_URL
  if (!backendUrl) {
    return NextResponse.json({ error: "RAG backend URL is not configured" }, { status: 500 })
  }

  const body = (await req.json()) as Partial<RagAskRequest>
  if (!body.query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 })
  }

  const payload: RagAskRequest = {
    query: body.query,
    userId: session.user.id,
    topK: body.topK ?? 5,
  }

  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  const data = (await response.json()) as RagAskResponse | { error?: string }
  if (!response.ok) {
    const errorMessage = "error" in data ? data.error : undefined
    return NextResponse.json({ error: errorMessage ?? "RAG ask failed" }, { status: response.status })
  }

  return NextResponse.json(data)
}