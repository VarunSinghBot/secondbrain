import type { RagIndexRequest, RagIndexResponse } from "@secondbrain/types"

export async function queueRagIndexing(payload: RagIndexRequest): Promise<{ ok: boolean; data?: RagIndexResponse; error?: string } | null> {
  const ragBackendUrl = process.env.RAG_BACKEND_URL
  if (!ragBackendUrl) return null

  try {
    const response = await fetch(`${ragBackendUrl.replace(/\/$/, "")}/index`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.RAG_INTERNAL_SECRET ?? "",
      },
      body: JSON.stringify(payload),
    })

    const raw = await response.json().catch(() => null) as RagIndexResponse | { error?: string } | null
    const data = raw ?? undefined
    return response.ok
      ? { ok: true, data: data as RagIndexResponse | undefined }
      : { ok: false, data: data as RagIndexResponse | undefined, error: (data && "error" in data ? data.error : undefined) ?? `RAG backend returned ${response.status}` }
  } catch (error) {
    console.error("Failed to queue RAG indexing:", error)
    return { ok: false, error: error instanceof Error ? error.message : "Failed to call RAG backend" }
  }
}