export type ContentType = "article" | "image" | "audio" | "video"
export type MediaTool = "image" | "audio" | "video"

export const escapeHtmlAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

export const extractYouTubeVideoId = (input: string) => {
  try {
    const url = new URL(input)
    if (!url.hostname.includes("youtube.com") && !url.hostname.includes("youtu.be")) return null

    if (url.hostname.includes("youtu.be")) {
      const pathId = url.pathname.split("/").filter(Boolean)[0]
      return pathId ?? null
    }

    return url.searchParams.get("v")
  } catch {
    const match = input.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i)
    return match?.[1] ?? null
  }
}

export const buildMediaHtml = (tool: MediaTool, input: string) => {
  const url = input.trim()
  if (!url) return ""

  if (tool === "image") {
    return `<img src="${escapeHtmlAttribute(url)}" style="max-width:100%;border-radius:8px;margin:8px 0;" />`
  }

  if (tool === "audio") {
    return `<audio controls src="${escapeHtmlAttribute(url)}" style="width:100%;margin:8px 0;"></audio>`
  }

  const youtubeId = extractYouTubeVideoId(url)
  if (youtubeId) {
    return `<iframe width="100%" height="400" src="https://www.youtube.com/embed/${escapeHtmlAttribute(youtubeId)}" frameborder="0" allowfullscreen style="border-radius:8px;margin:8px 0;"></iframe>`
  }

  return `<video controls src="${escapeHtmlAttribute(url)}" style="max-width:100%;border-radius:8px;margin:8px 0;"></video>`
}
