import { config, requireConfig } from "./config"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function flattenMarkdownResponse(data: Record<string, unknown>): string {
  if (typeof data.markdown_full === "string") return data.markdown_full
  if (typeof data.text_full === "string") return data.text_full

  const markdown = data.markdown as { pages?: Array<{ markdown?: string }> } | undefined
  if (markdown?.pages?.length) {
    return markdown.pages.map((page) => page.markdown ?? "").join("\n\n")
  }

  const text = data.text as { pages?: Array<{ text?: string }> } | undefined
  if (text?.pages?.length) {
    return text.pages.map((page) => page.text ?? "").join("\n\n")
  }

  return ""
}

export async function parseDocumentFromUrl(sourceUrl: string): Promise<string> {
  const apiKey = requireConfig(config.llamaCloudApiKey, "LLAMA_CLOUD_API_KEY")

  const createResponse = await fetch("https://api.cloud.llamaindex.ai/api/v2/parse", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_url: sourceUrl,
      tier: "cost_effective",
      version: "latest",
      expand: ["markdown_full"],
    }),
  })

  if (!createResponse.ok) {
    throw new Error(`LlamaParse job creation failed: ${createResponse.status} ${createResponse.statusText}`)
  }

  const createData = await createResponse.json() as { id?: string; status?: string; job?: { id?: string; status?: string } }
  const jobId = createData.id ?? createData.job?.id
  if (!jobId) throw new Error("LlamaParse response missing job id")

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const resultResponse = await fetch(`https://api.cloud.llamaindex.ai/api/v2/parse/${jobId}?expand=markdown_full,text_full`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!resultResponse.ok) {
      throw new Error(`LlamaParse polling failed: ${resultResponse.status} ${resultResponse.statusText}`)
    }

    const resultData = await resultResponse.json() as Record<string, unknown> & { job?: { status?: string; error_message?: string | null } }
    const status = resultData.job?.status ?? ""

    if (status === "COMPLETED") {
      const text = flattenMarkdownResponse(resultData)
      if (!text) {
        throw new Error("LlamaParse completed without text output")
      }

      return text
    }

    if (status === "FAILED" || status === "CANCELLED") {
      throw new Error(resultData.job?.error_message ?? `LlamaParse job ${status.toLowerCase()}`)
    }

    await sleep(2000)
  }

  throw new Error("LlamaParse timed out while waiting for document parsing")
}