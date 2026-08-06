export function stripHtml(input: string): string {
  return input.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
}

export function normalizeText(input: string): string {
  return stripHtml(input)
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export interface Chunk {
  text: string
  index: number
  tokenCount: number
}

export function chunkText(text: string, chunkSize = 1200, overlap = 150): Chunk[] {
  const normalized = normalizeText(text)
  if (!normalized) return []

  const chunks: Chunk[] = []
  let start = 0
  let index = 0

  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + chunkSize)
    const chunk = normalized.slice(start, end).trim()

    if (chunk) {
      chunks.push({
        text: chunk,
        index,
        tokenCount: Math.ceil(chunk.length / 4),
      })
      index += 1
    }

    if (end === normalized.length) break
    start = Math.max(0, end - overlap)
  }

  return chunks
}