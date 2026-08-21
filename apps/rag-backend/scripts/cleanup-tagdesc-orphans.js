// One-off cleanup for the orphaned "-tagdesc" contentId bug (image.ts,
// fixed alongside this script): every image ever indexed left a permanent
// orphan in rag_text under contentId `${contentId}-tagdesc`, which
// deleteContentVectors(userId, contentId) can never match on delete/edit/
// reindex. This scans rag_text for that suffix and removes every match —
// they're all orphans by definition, since nothing was ever supposed to
// produce this suffix once the fix lands. Not a permanent route; run once
// with `node scripts/cleanup-tagdesc-orphans.js` from apps/rag-backend.
require("dotenv").config()
const { Client } = require("pg")

const QDRANT_URL = process.env.QDRANT_URL
const QDRANT_API_KEY = process.env.QDRANT_API_KEY
const COLLECTION = process.env.QDRANT_COLLECTION || "rag_text"
const SUFFIX = "-tagdesc"

async function qdrant(path, body) {
  const res = await fetch(`${QDRANT_URL}${path}`, {
    method: "POST",
    headers: { "api-key": QDRANT_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Qdrant ${path} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function main() {
  if (!QDRANT_URL || !QDRANT_API_KEY) {
    throw new Error("QDRANT_URL / QDRANT_API_KEY not configured")
  }

  const pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await pg.connect()

  const orphans = []
  let offset = undefined
  do {
    const page = await qdrant(`/collections/${COLLECTION}/points/scroll`, {
      limit: 200,
      offset,
      with_payload: true,
      with_vector: false,
    })
    for (const point of page.result.points) {
      const contentId = point.payload?.contentId
      if (typeof contentId === "string" && contentId.endsWith(SUFFIX)) {
        orphans.push({ pointId: point.id, contentId })
      }
    }
    offset = page.result.next_page_offset
  } while (offset)

  console.log(`Found ${orphans.length} orphaned "-tagdesc" point(s) in ${COLLECTION}.`)

  let baseStillExists = 0
  let baseGone = 0
  for (const o of orphans) {
    const baseContentId = o.contentId.slice(0, -SUFFIX.length)
    const { rowCount } = await pg.query('SELECT 1 FROM "Content" WHERE id = $1', [baseContentId])
    if (rowCount > 0) baseStillExists++
    else baseGone++
  }
  console.log(`  - base Content row still exists: ${baseStillExists}`)
  console.log(`  - base Content row already gone (deleted image, orphan doubly stale): ${baseGone}`)

  if (orphans.length > 0) {
    await qdrant(`/collections/${COLLECTION}/points/delete`, {
      points: orphans.map((o) => o.pointId),
    })
    console.log(`Deleted ${orphans.length} orphaned point(s).`)
  } else {
    console.log("Nothing to delete.")
  }

  await pg.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
