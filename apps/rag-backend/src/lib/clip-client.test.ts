import { describe, expect, it, vi } from "vitest"

// Port nothing listens on, so embedImage/tagImage genuinely hit a
// connection-refused error rather than a mocked one — exercises the real
// fetch() failure path, not a simulated one.
//
// vi.hoisted (rather than a plain const) is required here: vi.mock's
// factory below is hoisted above all other top-level code, so a plain
// const referenced inside it would still be uninitialized when the
// factory runs.
const { UNREACHABLE_URL } = vi.hoisted(() => ({ UNREACHABLE_URL: "http://127.0.0.1:59999" }))

vi.mock("./config", () => ({
  config: { clipSidecarUrl: UNREACHABLE_URL, clipTagThreshold: 0.19, clipTagTopN: 5 },
  requireConfig: (value: string, name: string) => {
    if (!value) throw new Error(`${name} is not configured`)
    return value
  },
}))

// Safe as a static import here (unlike worker/queue.test.ts's RAG_JOBS_FILE
// case): vi.mock above is hoisted by vitest ahead of all imports, so it
// doesn't depend on this import running after some prior line.
import { ClipSidecarUnavailableError, embedImage, tagImage } from "./clip-client"

describe("clip-client: CLIP sidecar unavailable", () => {
  it("embedImage throws ClipSidecarUnavailableError naming the sidecar when unreachable", async () => {
    await expect(embedImage(Buffer.from("fake-image-bytes"), "image/jpeg")).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ClipSidecarUnavailableError)
      const message = (err as Error).message
      expect(message).toContain("CLIP sidecar")
      expect(message).toContain(UNREACHABLE_URL)
      expect(message).toContain("CLIP_SIDECAR_URL")
      return true
    })
  })

  it("tagImage throws ClipSidecarUnavailableError naming the sidecar when unreachable", async () => {
    await expect(tagImage(Buffer.from("fake-image-bytes"), "image/jpeg")).rejects.toBeInstanceOf(ClipSidecarUnavailableError)
  })
})
