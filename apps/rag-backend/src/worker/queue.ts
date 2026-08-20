import fs from "fs"
import path from "path"
import { randomUUID } from "node:crypto"
import type { RagIndexRequest } from "@secondbrain/types"
import { indexContent } from "../services/indexer"

// RAG_JOBS_FILE is an internal test seam (not a documented/public config
// value) so tests can point the queue at an isolated file instead of
// racing the real job store or a concurrently-running dev server.
const JOB_FILE = process.env.RAG_JOBS_FILE
  ? path.resolve(process.env.RAG_JOBS_FILE)
  : path.resolve(process.cwd(), ".rag_jobs.json")

export type JobStatus = "queued" | "processing" | "completed" | "failed"

export interface JobRecord {
  id: string
  status: JobStatus
  payload: RagIndexRequest
  result?: unknown
  error?: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Serializes a chain of operations so calls can never interleave, even
 * across await points — a plain boolean/status field only guards the
 * synchronous gap between a check and a set, not the async work in
 * between. Two independent Mutex instances are used below: one for the
 * (fast) job-file read-modify-write cycle, and one for the (slow) actual
 * job processing — kept separate so a long-running indexContent() call
 * doesn't block new jobs from being enqueued while it runs.
 */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(fn, fn)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

const fileLock = new Mutex()
const processingLock = new Mutex()

function loadJobsUnsafe(): Record<string, JobRecord> {
  try {
    if (!fs.existsSync(JOB_FILE)) return {}
    const raw = fs.readFileSync(JOB_FILE, "utf8")
    if (!raw.trim()) return {}
    return JSON.parse(raw) as Record<string, JobRecord>
  } catch (err) {
    console.error("queue: failed to read/parse job store, treating as empty:", err)
    return {}
  }
}

// Write to a temp file in the same directory, then rename over the real
// path. Rename is atomic on both POSIX and Windows (libuv uses
// MoveFileEx with MOVEFILE_REPLACE_EXISTING) — any reader either sees the
// fully-old or fully-new file, never a partial write.
function saveJobsUnsafe(jobs: Record<string, JobRecord>) {
  const tmpFile = path.join(path.dirname(JOB_FILE), `.rag_jobs.${randomUUID()}.tmp`)
  fs.writeFileSync(tmpFile, JSON.stringify(jobs, null, 2), "utf8")
  fs.renameSync(tmpFile, JOB_FILE)
}

export async function addJob(payload: RagIndexRequest): Promise<string> {
  const id = randomUUID()
  await fileLock.run(() => {
    const jobs = loadJobsUnsafe()
    jobs[id] = {
      id,
      status: "queued",
      payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    saveJobsUnsafe(jobs)
  })
  return id
}

export async function getJob(id: string): Promise<JobRecord | null> {
  return fileLock.run(() => loadJobsUnsafe()[id] ?? null)
}

async function setJob(id: string, patch: Partial<JobRecord>) {
  await fileLock.run(() => {
    const jobs = loadJobsUnsafe()
    const job = jobs[id]
    if (!job) return
    jobs[id] = { ...job, ...patch, updatedAt: new Date().toISOString() }
    saveJobsUnsafe(jobs)
  })
}

// Atomically finds the oldest queued job and marks it "processing" in one
// locked read-modify-write, so two overlapping loop() ticks can never both
// claim the same job.
async function claimNextQueuedJob(): Promise<JobRecord | null> {
  return fileLock.run(() => {
    const jobs = loadJobsUnsafe()
    const next = Object.values(jobs)
      .filter((j) => j.status === "queued")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    if (!next) return null

    const claimed: JobRecord = { ...next, status: "processing", updatedAt: new Date().toISOString() }
    jobs[next.id] = claimed
    saveJobsUnsafe(jobs)
    return claimed
  })
}

let workerStarted = false

export async function startWorker(): Promise<void> {
  if (workerStarted) return
  workerStarted = true

  async function loop() {
    const next = await claimNextQueuedJob()
    if (!next) return

    // processingLock ensures only one indexContent() call is ever in
    // flight, even if something in the future kicks off a second loop.
    await processingLock.run(async () => {
      try {
        const chunks = await indexContent(next.payload)
        await setJob(next.id, { status: "completed", result: { chunks } })
      } catch (err) {
        await setJob(next.id, { status: "failed", error: err instanceof Error ? err.message : String(err) })
      }
    })

    setImmediate(loop)
  }

  setImmediate(loop)
}

export default startWorker
