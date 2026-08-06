import { config, requireConfig } from "./config"

export interface QdrantPayload {
  contentId: string
  userId: string
  sourceType: string
  sourceUrl?: string | null
  sourceName?: string | null
  chunkIndex: number
  text: string
  metadata?: Record<string, unknown> | null
}

async function qdrantRequest(path: string, init?: RequestInit): Promise<Response> {
  const url = `${requireConfig(config.qdrantUrl, "QDRANT_URL").replace(/\/$/, "")}${path}`
  const headers = new Headers(init?.headers)
  const apiKey = config.qdrantApiKey
  if (apiKey) headers.set("api-key", apiKey)
  headers.set("Content-Type", "application/json")
  return fetch(url, { ...init, headers })
}

export async function ensureCollection(): Promise<void> {
  const response = await qdrantRequest(`/collections/${config.qdrantCollection}`)
  if (response.status !== 404) {
    if (!response.ok) return
    return
  }

  const createResponse = await qdrantRequest(`/collections/${config.qdrantCollection}`, {
    method: "PUT",
    body: JSON.stringify({
      vectors: {
        size: config.qdrantVectorSize,
        distance: "Cosine",
      },
    }),
  })

  if (!createResponse.ok) {
    throw new Error(`Failed to create Qdrant collection: ${createResponse.status} ${createResponse.statusText}`)
  }
}

export async function upsertChunk(pointId: string, vector: number[], payload: QdrantPayload): Promise<void> {
  await ensureCollection()

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
    throw new Error(`Qdrant upsert failed: ${response.status} ${response.statusText}`)
  }
}

async function deleteByFilter(filter: Record<string, unknown>): Promise<void> {
  await ensureCollection()

  const response = await qdrantRequest(`/collections/${config.qdrantCollection}/points/delete?wait=true`, {
    method: "POST",
    body: JSON.stringify({ filter }),
  })

  if (!response.ok) {
    throw new Error(`Qdrant delete failed: ${response.status} ${response.statusText}`)
  }
}

export async function deleteContentVectors(userId: string, contentId: string): Promise<void> {
  await deleteByFilter({
    must: [
      { key: "userId", match: { value: userId } },
      { key: "contentId", match: { value: contentId } },
    ],
  })
}

export async function deleteUserVectors(userId: string): Promise<void> {
  await deleteByFilter({
    must: [{ key: "userId", match: { value: userId } }],
  })
}

export interface SearchHit {
  id: string | number
  score: number
  payload?: Record<string, unknown>
}

export async function searchSimilar(vector: number[], userId: string, limit = 5): Promise<SearchHit[]> {
  await ensureCollection()

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
    throw new Error(`Qdrant search failed: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as { result?: SearchHit[] }
  return data.result ?? []
}