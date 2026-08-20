import { describe, expect, it } from "vitest"

import { chunkText, normalizeText } from "./text"

function isMidWord(text: string, pos: number): boolean {
  if (pos <= 0 || pos >= text.length) return false
  return !/\s/.test(text[pos - 1]) && !/\s/.test(text[pos])
}

// Every sentence is unique (numbered) so indexOf can never match the wrong
// occurrence — LOREM.repeat(n) would create ambiguous duplicate substrings
// that make position-recovery in the assertions unreliable.
function uniqueLoremOfLength(sentenceCount: number): string {
  const sentences: string[] = []
  for (let i = 0; i < sentenceCount; i++) {
    sentences.push(
      `Sentence number ${i} discusses retrieval augmented generation and how chunk boundary number ${i} should respect word breaks so embeddings stay meaningful.`
    )
  }
  return sentences.join(" ")
}

describe("chunkText", () => {
  it("produces no mid-word cuts across a range of input lengths and chunk sizes", () => {
    // Deliberately excludes a single-token, whitespace-free input: chunkText's
    // documented fallback allows a mid-word cut there rather than shrink a
    // chunk unpredictably. That fallback path is covered separately below.
    const inputs = [
      uniqueLoremOfLength(3),
      uniqueLoremOfLength(15),
      uniqueLoremOfLength(60),
      "short text under one chunk",
    ]
    const configs: Array<[number, number]> = [
      [1200, 150],
      [300, 50],
      [80, 20],
      [40, 10], // chunkSize smaller than the word-boundary search window
    ]

    for (const input of inputs) {
      for (const [chunkSize, overlap] of configs) {
        const normalized = normalizeText(input)
        const chunks = chunkText(input, chunkSize, overlap)

        let searchFrom = 0
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]
          const foundAt = normalized.indexOf(chunk.text, searchFrom)
          expect(foundAt).toBeGreaterThanOrEqual(0)

          const isLastChunk = i === chunks.length - 1
          const endsAtSourceEnd = foundAt + chunk.text.length === normalized.length

          if (!isLastChunk || !endsAtSourceEnd) {
            expect(isMidWord(normalized, foundAt)).toBe(false)
            expect(isMidWord(normalized, foundAt + chunk.text.length)).toBe(false)
          }

          // chunkText guarantees each chunk's start strictly increases, so
          // the next occurrence must be found after this chunk's start.
          searchFrom = foundAt + 1
        }
      }
    }
  })

  it("still makes forward progress and terminates when a single token has no whitespace", () => {
    const chunks = chunkText("a".repeat(1000), 40, 10)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[chunks.length - 1].text.length).toBeGreaterThan(0)
  })

  it("returns the full text as one chunk when shorter than chunkSize", () => {
    const chunks = chunkText("A short note.", 1200, 150)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe("A short note.")
  })
})
