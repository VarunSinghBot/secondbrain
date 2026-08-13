import { config } from "./config"

export interface TagImageResponse {
  tags: string[]
  scores: Record<string, number>
}

export async function embedImage(imageBuffer: Buffer, mimeType = "image/jpeg"): Promise<number[]> {
  const url = `${config.clipSidecarUrl.replace(/\/$/, "")}/embed-image`
  const formData = new FormData()
  const ext = mimeType.split("/")[1] || "jpeg"
  formData.append("file", new Blob([imageBuffer], { type: mimeType }), `image.${ext}`)

  const res = await fetch(url, {
    method: "POST",
    body: formData,
  })

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
  const res = await fetch(url, {
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

export async function tagImage(imageBuffer: Buffer, mimeType = "image/jpeg", threshold = 0.18, topK = 8): Promise<string[]> {
  const query = new URLSearchParams({
    threshold: threshold.toString(),
    top_k: topK.toString(),
  })
  const url = `${config.clipSidecarUrl.replace(/\/$/, "")}/tag-image?${query.toString()}`
  const formData = new FormData()
  const ext = mimeType.split("/")[1] || "jpeg"
  formData.append("file", new Blob([imageBuffer], { type: mimeType }), `image.${ext}`)

  const res = await fetch(url, {
    method: "POST",
    body: formData,
  })

  if (!res.ok) {
    throw new Error(`CLIP tag-image failed: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as TagImageResponse
  return data.tags ?? []
}
