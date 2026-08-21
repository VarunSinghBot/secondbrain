import { config, requireConfig } from "./config"

export interface QdrantPayload {
  contentId: string
  userId: string
  sourceType: string
  sourceUrl?: string | null
  sourceName?: string | null
  sourceTitle?: string | null
  cloudinaryUrl?: string | null
  modality?: string | null
  tags?: string[] | null
  caption?: string | null
  chunkIndex: number
  text: string
  metadata?: Record<string, unknown> | null
  // Only set for modality "video_frame" — where in the source video (in
  // seconds) this frame was sampled from.
  timestampSeconds?: number | null
}

export async function qdrantRequest(path: string, init?: RequestInit): Promise<Response> {
  const url = `${requireConfig(config.qdrantUrl, "QDRANT_URL").replace(/\/$/, "")}${path}`
  const headers = new Headers(init?.headers)
  const apiKey = config.qdrantApiKey
  if (apiKey) headers.set("api-key", apiKey)
  headers.set("Content-Type", "application/json")
  return fetch(url, { ...init, headers })
}

async function ensurePayloadIndex(collectionName: string, fieldName: string): Promise<void> {
  await qdrantRequest(`/collections/${collectionName}/index?wait=true`, {
    method: "PUT",
    body: JSON.stringify({
      field_name: fieldName,
      field_schema: "keyword",
    }),
  }).catch(() => {})
}

export async function ensureCollection(collectionName: string, vectorSize: number): Promise<void> {
  let needIndex = false
  const response = await qdrantRequest(`/collections/${collectionName}`)
  if (response.status !== 404) {
    if (response.ok) {
      const data = (await response.json()) as {
        result?: {
          config?: {
            params?: {
              vectors?: {
                size?: number
              }
            }
          }
        }
      }
      const existingSize = data.result?.config?.params?.vectors?.size
      if (existingSize && existingSize !== vectorSize) {
        console.log(`Recreating collection '${collectionName}' due to size mismatch (existing: ${existingSize}, expected: ${vectorSize})`)
        await qdrantRequest(`/collections/${collectionName}`, { method: "DELETE" })
        needIndex = true
      } else {
        // Ensure both fields are indexed for existing collections
        await ensurePayloadIndex(collectionName, "userId")
        await ensurePayloadIndex(collectionName, "contentId")
        return
      }
    } else {
      return
    }
  } else {
    needIndex = true
  }

  if (needIndex) {
    const createResponse = await qdrantRequest(`/collections/${collectionName}`, {
      method: "PUT",
      body: JSON.stringify({
        vectors: {
          size: vectorSize,
          distance: "Cosine",
        },
      }),
    })

    if (!createResponse.ok) {
      throw new Error(`Failed to create Qdrant collection '${collectionName}': ${createResponse.status} ${createResponse.statusText}`)
    }

    // Create payload indexes for both strict-filtering fields
    await ensurePayloadIndex(collectionName, "userId")
    await ensurePayloadIndex(collectionName, "contentId")
  }
}

export async function ensureCollections(): Promise<void> {
  await Promise.all([
    ensureCollection(config.qdrantCollection, config.qdrantVectorSize), // rag_text (768-dim)
    ensureCollection(config.qdrantImageCollection, 512),               // rag_images (512-dim CLIP)
  ])
}

export async function upsertChunk(pointId: string, vector: number[], payload: QdrantPayload): Promise<void> {
  await ensureCollections()

  const response = await qdrantRequest(`/collections/${config.qdrantCollection}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({
      points: [{
        id: pointId,
        vector,
        payload,
      }],
    }),
  })

  if (!response.ok) {
    throw new Error(`Qdrant text chunk upsert failed: ${response.status} ${response.statusText}`)
  }
}

export async function upsertImageVector(pointId: string, vector: number[], payload: QdrantPayload): Promise<void> {
  await ensureCollections()

  const response = await qdrantRequest(`/collections/${config.qdrantImageCollection}/points?wait=true`, {
    method: "PUT",
    body: JSON.stringify({
      points: [{
        id: pointId,
        vector,
        payload,
      }],
    }),
  })

  if (!response.ok) {
    throw new Error(`Qdrant image vector upsert failed: ${response.status} ${response.statusText}`)
  }
}

async function deleteByFilter(collectionName: string, filter: Record<string, unknown>): Promise<void> {
  await ensureCollections()

  const response = await qdrantRequest(`/collections/${collectionName}/points/delete?wait=true`, {
    method: "POST",
    body: JSON.stringify({ filter }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => "")
    throw new Error(`Qdrant delete failed for '${collectionName}': ${response.status} ${response.statusText} - ${errText}`)
  }
}

export async function deleteContentVectors(userId: string, contentId: string): Promise<void> {
  const filter = {
    must: [
      { key: "userId", match: { value: userId } },
      { key: "contentId", match: { value: contentId } },
    ],
  }
  await Promise.all([
    deleteByFilter(config.qdrantCollection, filter).catch(err => {
      console.error(`deleteContentVectors text failed:`, err)
      throw err
    }),
    deleteByFilter(config.qdrantImageCollection, filter).catch(err => {
      console.error(`deleteContentVectors image failed:`, err)
      throw err
    }),
  ])
}

export async function deleteUserVectors(userId: string): Promise<void> {
  const filter = {
    must: [{ key: "userId", match: { value: userId } }],
  }
  await Promise.all([
    deleteByFilter(config.qdrantCollection, filter).catch(err => {
      console.error(`deleteUserVectors text failed:`, err)
      throw err
    }),
    deleteByFilter(config.qdrantImageCollection, filter).catch(err => {
      console.error(`deleteUserVectors image failed:`, err)
      throw err
    }),
  ])
}

export interface SearchHit {
  id: string | number
  score: number
  payload?: Record<string, unknown>
}

export async function searchSimilar(vector: number[], userId: string, limit = 5): Promise<SearchHit[]> {
  await ensureCollections()

  const response = await qdrantRequest(`/collections/${config.qdrantCollection}/points/search`, {
    method: "POST",
    body: JSON.stringify({
      vector,
      limit,
      with_payload: true,
      filter: {
        must: [{ key: "userId", match: { value: userId } }],
      },
    }),
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => "")
    throw new Error(`Qdrant text search failed: ${response.status} ${response.statusText} - ${errText}`)
  }

  const data = (await response.json()) as { result?: SearchHit[] }
  const hits = data.result ?? []

  console.log(`[qdrant:searchSimilar] userId=${userId} rawHits=${hits.length}`, 
    hits.map(h => ({ 
      modality: h.payload?.modality, 
      score: h.score, 
      preview: String(h.payload?.text ?? "").slice(0, 60) 
    }))
  );

  return hits
}

export async function searchSimilarImages(vector: number[], userId: string, limit = 5): Promise<SearchHit[]> {
  await ensureCollections()

  const response = await qdrantRequest(`/collections/${config.qdrantImageCollection}/points/search`, {
    method: "POST",
    body: JSON.stringify({
      vector,
      limit,
      with_payload: true,
      filter: {
        must: [{ key: "userId", match: { value: userId } }],
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Qdrant image search failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as { result?: SearchHit[] }
  const hits = data.result ?? []

  console.log(`[qdrant:searchSimilarImages] userId=${userId} rawHits=${hits.length}`, 
    hits.map(h => ({ 
      modality: h.payload?.modality, 
      score: h.score, 
      preview: String(h.payload?.text ?? h.payload?.caption ?? "").slice(0, 60) 
    }))
  );

  return hits
}