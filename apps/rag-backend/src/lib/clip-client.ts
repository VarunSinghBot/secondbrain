import { config } from "./config"

export interface TagImageResponse {
  tags: string[]
  scores: Record<string, number>
}

// Thrown specifically when the CLIP sidecar can't be reached at all (it's
// not running, wrong port, etc.) — as opposed to it being up but returning
// an error. Callers use this distinction to return 503 (service down) vs
// 500 (something else went wrong) instead of a bare 500 either way.
export class ClipSidecarUnavailableError extends Error {
  constructor(url: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    super(`CLIP sidecar unavailable: could not reach ${url}. Is the CLIP sidecar running (see CLIP_SIDECAR_URL)? (${reason})`)
    this.name = "ClipSidecarUnavailableError"
  }
}

async function fetchSidecar(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (err) {
    // fetch() only throws for connection-level failures (refused, DNS,
    // reset, timeout) — a reachable server that errors returns a normal
    // (non-ok) Response instead, handled separately by each caller below.
    throw new ClipSidecarUnavailableError(url, err)
  }
}

export async function embedImage(imageBuffer: Buffer, mimeType = "image/jpeg"): Promise<number[]> {
  const url = `${config.clipSidecarUrl.replace(/\/$/, "")}/embed-image`
  const formData = new FormData()
  const ext = mimeType.split("/")[1] || "jpeg"
  formData.append("file", new Blob([imageBuffer], { type: mimeType }), `image.${ext}`)

  const res = await fetchSidecar(url, { method: "POST", body: formData })

  if (!res.ok) {
    throw new Error(`CLIP embed-image failed: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as { embedding?: number[] }
  if (!data.embedding?.length) {
    throw new Error("CLIP embed-image returned invalid vector")
  }
  return data.embedding
}

export async function embedTextClip(text: string): Promise<number[]> {
  const url = `${config.clipSidecarUrl.replace(/\/$/, "")}/embed-text-clip`
  const res = await fetchSidecar(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  })

  if (!res.ok) {
    throw new Error(`CLIP embed-text-clip failed: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as { embedding?: number[] }
  if (!data.embedding?.length) {
    throw new Error("CLIP embed-text-clip returned invalid vector")
  }
  return data.embedding
}

export async function tagImage(
  imageBuffer: Buffer,
  mimeType = "image/jpeg",
  threshold = config.clipTagThreshold,
  topK = config.clipTagTopN,
): Promise<string[]> {
  const query = new URLSearchParams({
    threshold: threshold.toString(),
    top_k: topK.toString(),
  })
  const url = `${config.clipSidecarUrl.replace(/\/$/, "")}/tag-image?${query.toString()}`
  const formData = new FormData()
  const ext = mimeType.split("/")[1] || "jpeg"
  formData.append("file", new Blob([imageBuffer], { type: mimeType }), `image.${ext}`)

  const res = await fetchSidecar(url, { method: "POST", body: formData })

  if (!res.ok) {
    throw new Error(`CLIP tag-image failed: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as TagImageResponse
  return data.tags ?? []
}
