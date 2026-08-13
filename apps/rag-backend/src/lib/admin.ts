import { ensureCollection } from "./qdrant"
import { config } from "./config"

/**
 * Wipes and recreates both Qdrant collections.
 * Called once after switching embedding models.
 */
export async function resetCollections(): Promise<void> {
  const qdrantUrl = config.qdrantUrl
  const apiKey = config.qdrantApiKey
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (apiKey) {
    headers["api-key"] = apiKey
  }

  // 1. Delete rag_text if it exists
  const textUrl = `${qdrantUrl.replace(/\/$/, "")}/collections/${config.qdrantCollection}`
  console.log(`[admin:resetCollections] Deleting text collection: ${config.qdrantCollection}`)
  await fetch(textUrl, { method: "DELETE", headers }).catch((e) => {
    console.warn(`Failed to delete text collection:`, e)
  })

  // 2. Delete rag_images if it exists
  const imageUrl = `${qdrantUrl.replace(/\/$/, "")}/collections/${config.qdrantImageCollection}`
  console.log(`[admin:resetCollections] Deleting image collection: ${config.qdrantImageCollection}`)
  await fetch(imageUrl, { method: "DELETE", headers }).catch((e) => {
    console.warn(`Failed to delete image collection:`, e)
  })

  // 3 & 4. Recreate collections
  console.log(`[admin:resetCollections] Recreating text collection (768-dim)`)
  await ensureCollection(config.qdrantCollection, config.qdrantVectorSize)
  
  console.log(`[admin:resetCollections] Recreating image collection (512-dim)`)
  await ensureCollection(config.qdrantImageCollection, 512)

  // 5. Log
  console.log("Collections reset. All content must be re-ingested.")
}
