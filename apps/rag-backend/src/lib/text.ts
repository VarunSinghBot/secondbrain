/**
 * Joins tags into a natural-language list ("a, b, and c") instead of a
 * comma-separated field dump, so image/video-frame descriptions read as
 * prose rather than a labeled form when embedded and later shown to the LLM.
 */
export function joinNaturally(items: string[]): string {
  if (items.length === 0) return ""
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`
}

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

const WORD_BOUNDARY_SEARCH_WINDOW = 50

/**
 * Nudges a cut position back to the nearest preceding whitespace, so chunk
 * (and overlap) boundaries land between words instead of mid-word. Falls
 * back to the original position if no whitespace is found within the
 * search window — better to keep a rare mid-word cut than shrink a chunk
 * unpredictably.
 */
function snapToWordBoundary(text: string, pos: number, minPos: number): number {
  if (pos >= text.length || /\s/.test(text[pos])) return pos

  const floor = Math.max(minPos, pos - WORD_BOUNDARY_SEARCH_WINDOW)
  for (let i = pos; i > floor; i--) {
    if (/\s/.test(text[i - 1])) return i
  }

  return pos
}

export function chunkText(text: string, chunkSize = 1200, overlap = 150): Chunk[] {
  const normalized = normalizeText(text)
  if (!normalized) return []

  const chunks: Chunk[] = []
  let start = 0
  let index = 0

  while (start < normalized.length) {
    const rawEnd = Math.min(normalized.length, start + chunkSize)
    // minPos=start guarantees end > start, so every chunk makes forward
    // progress even with a tiny chunkSize relative to the search window.
    const end = rawEnd === normalized.length ? rawEnd : snapToWordBoundary(normalized, rawEnd, start)
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

    const snappedStart = snapToWordBoundary(normalized, Math.max(0, end - overlap), 0)
    // If snapping the overlap backward would land at or before the current
    // start (possible with a tiny overlap/chunkSize), skip the overlap
    // rather than stall the loop.
    start = snappedStart > start ? snappedStart : end
  }

  return chunks
}