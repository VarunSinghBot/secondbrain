import fs from "fs"
import path from "path"
import { randomUUID } from "node:crypto"
import type { RagIndexRequest } from "@secondbrain/types"
import { indexContent } from "../services/indexer"

const JOB_FILE = path.resolve(process.cwd(), ".rag_jobs.json")

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

function loadJobs(): Record<string, JobRecord> {
  try {
    if (!fs.existsSync(JOB_FILE)) return {}
    const raw = fs.readFileSync(JOB_FILE, "utf8")
    return JSON.parse(raw) as Record<string, JobRecord>
  } catch (err) {
    return {}
  }
}

function saveJobs(jobs: Record<string, JobRecord>) {
  fs.writeFileSync(JOB_FILE, JSON.stringify(jobs, null, 2), "utf8")
}

export async function addJob(payload: RagIndexRequest): Promise<string> {
  const jobs = loadJobs()
  const id = randomUUID()
  const job: JobRecord = {
    id,
    status: "queued",
    payload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  jobs[id] = job
  saveJobs(jobs)
  return id
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const jobs = loadJobs()
  return jobs[id] ?? null
}

async function setJob(id: string, patch: Partial<JobRecord>) {
  const jobs = loadJobs()
  const job = jobs[id]
  if (!job) return
  jobs[id] = { ...job, ...patch, updatedAt: new Date().toISOString() }
  saveJobs(jobs)
}

let processing = false

export async function startWorker(): Promise<void> {
  if (processing) return
  processing = true

  async function loop() {
    const jobs = loadJobs()
    const next = Object.values(jobs).find((j) => j.status === "queued")
    if (!next) return

    await setJob(next.id, { status: "processing" })
    try {
      const chunks = await indexContent(next.payload)
      await setJob(next.id, { status: "completed", result: { chunks } })
    } catch (err) {
      await setJob(next.id, { status: "failed", error: err instanceof Error ? err.message : String(err) })
    }
    // continue processing remaining jobs
    setImmediate(loop)
  }

  // Kick off a single loop
  setImmediate(loop)
}

export default startWorker
