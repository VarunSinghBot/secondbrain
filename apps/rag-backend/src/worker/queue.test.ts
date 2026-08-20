import fs from "fs"
import path from "path"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// Isolated per-run job file so this test never touches the real
// .rag_jobs.json or races a concurrently-running dev server.
const TMP_JOB_FILE = path.join(process.cwd(), `.rag_jobs.test-${randomUUID()}.json`)
process.env.RAG_JOBS_FILE = TMP_JOB_FILE

vi.mock("../services/indexer", () => ({
  // Artificial delay gives concurrent calls a real window to interleave —
  // if the file locking were broken, this is what would expose it.
  indexContent: vi.fn(async (payload: { contentId: string }) => {
    await new Promise((resolve) => setTimeout(resolve, 30))
    return [{ qdrantPointId: `point-${payload.contentId}`, chunkIndex: 0, text: `indexed:${payload.contentId}`, tokenCount: 5 }]
  }),
}))

// queue.ts reads RAG_JOBS_FILE at module-load time, so it must be imported
// dynamically after the env var above is set — a static top-level import
// would be hoisted ahead of that assignment, and CommonJS (this project's
// module target) doesn't allow top-level await to await a dynamic one.
let addJob: typeof import("./queue").addJob
let getJob: typeof import("./queue").getJob
let startWorker: typeof import("./queue").startWorker

beforeAll(async () => {
  const queue = await import("./queue")
  addJob = queue.addJob
  getJob = queue.getJob
  startWorker = queue.startWorker
})

function readRawJobFile(): Record<string, unknown> {
  const raw = fs.readFileSync(TMP_JOB_FILE, "utf8")
  return JSON.parse(raw) // throws if the file isn't valid, complete JSON
}

async function waitForTerminal(jobId: string, timeoutMs = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const job = await getJob(jobId)
    if (job && (job.status === "completed" || job.status === "failed")) return job
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`job ${jobId} did not reach a terminal state within ${timeoutMs}ms`)
}

afterAll(async () => {
  // startWorker()'s loop is a detached setImmediate chain, not something any
  // single test awaits to completion — once started (in the second test
  // below) it keeps running in the background past that test's own
  // assertions. Give it a moment to fully settle before the file disappears
  // out from under it; otherwise a trailing iteration can be caught
  // mid-write when the test process tears down, orphaning a .tmp file.
  await new Promise((resolve) => setTimeout(resolve, 200))
  fs.rmSync(TMP_JOB_FILE, { force: true })
})

describe("worker/queue file store", () => {
  it("drops no jobs when many addJob calls fire concurrently", async () => {
    const contentIds = Array.from({ length: 10 }, (_, i) => `concurrent-write-${i}-${randomUUID().slice(0, 6)}`)

    const jobIds = await Promise.all(
      contentIds.map((contentId) =>
        addJob({ contentId, userId: "test-user", sourceType: "article", text: "placeholder" })
      )
    )

    expect(new Set(jobIds).size).toBe(jobIds.length) // all ids unique

    const stored = readRawJobFile() // throws on corrupt/partial JSON
    for (const id of jobIds) {
      expect(stored[id]).toBeDefined()
    }
    expect(Object.keys(stored)).toHaveLength(contentIds.length)
  })

  it("processes two concurrent ingest jobs to completion without corrupting the store", async () => {
    // Clear the previous test's 10 queued-but-never-processed jobs first —
    // startWorker() below processes *every* queued job in the file, and
    // leaving those around would make this test (and its cleanup) wait on
    // unrelated background work.
    fs.writeFileSync(TMP_JOB_FILE, "{}", "utf8")

    const payloadA = { contentId: `job-a-${randomUUID().slice(0, 8)}`, userId: "test-user", sourceType: "article" as const, text: "Note A" }
    const payloadB = { contentId: `job-b-${randomUUID().slice(0, 8)}`, userId: "test-user", sourceType: "article" as const, text: "Note B" }

    const [jobIdA, jobIdB] = await Promise.all([addJob(payloadA), addJob(payloadB)])

    await startWorker()

    const [jobA, jobB] = await Promise.all([waitForTerminal(jobIdA), waitForTerminal(jobIdB)])

    expect(jobA.status).toBe("completed")
    expect(jobB.status).toBe("completed")

    // Each job's result must correspond to its own payload, not the other
    // job's — proves no cross-talk/overwrite between the two concurrent
    // read-modify-write cycles.
    const resultA = jobA.result as { chunks: Array<{ text: string }> }
    const resultB = jobB.result as { chunks: Array<{ text: string }> }
    expect(resultA.chunks[0].text).toContain(payloadA.contentId)
    expect(resultB.chunks[0].text).toContain(payloadB.contentId)

    // The store itself must still be one valid, complete JSON file
    // containing both finished jobs.
    const stored = readRawJobFile()
    expect(stored[jobIdA]).toMatchObject({ status: "completed" })
    expect(stored[jobIdB]).toMatchObject({ status: "completed" })
  })

  it("writes via temp-file-then-rename rather than overwriting the job file in place", async () => {
    // Directly verifies the specific mechanism Task 4 asks for: a reader
    // must never be able to observe a partially-written job file. Spies
    // call through to the real fs so the write still actually happens.
    const writeSpy = vi.spyOn(fs, "writeFileSync")
    const renameSpy = vi.spyOn(fs, "renameSync")

    try {
      await addJob({ contentId: `atomic-check-${randomUUID().slice(0, 6)}`, userId: "test-user", sourceType: "article", text: "x" })

      expect(writeSpy).toHaveBeenCalled()
      expect(renameSpy).toHaveBeenCalled()

      for (const call of writeSpy.mock.calls) {
        expect(call[0]).not.toBe(TMP_JOB_FILE) // never written to the real path directly
      }
      const [renameFrom, renameTo] = renameSpy.mock.calls.at(-1)!
      expect(renameFrom).not.toBe(TMP_JOB_FILE) // moved *from* a temp path
      expect(renameTo).toBe(TMP_JOB_FILE) // moved *onto* the real path
    } finally {
      writeSpy.mockRestore()
      renameSpy.mockRestore()
    }
  })
})
