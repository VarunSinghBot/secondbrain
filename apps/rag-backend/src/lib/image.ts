import { config, requireConfig } from "./config"
import { ClipSidecarUnavailableError, embedImage, tagImage } from "./clip-client"
import { embedText } from "./embeddings"
import { uploadToCloudinary } from "./cloudinary"
import { upsertChunk, upsertImageVector } from "./qdrant"
import { joinNaturally } from "./text"
import { randomUUID } from "node:crypto"

export async function extractOcrText(buffer: Buffer, fileName = "image.png"): Promise<string> {
  const apiKey = requireConfig(config.ocrSpaceApiKey, "OCR_SPACE_API_KEY")
  const formData = new FormData()
  formData.append("apikey", apiKey)
  formData.append("language", "eng")
  formData.append("isOverlayRequired", "false")
  formData.append("file", new Blob([buffer]), fileName)

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`OCR.Space request failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as {
    ParsedResults?: Array<{ ParsedText?: string }>
    IsErroredOnProcessing?: boolean
    ErrorMessage?: string[] | string
  }

  const parsedText = data.ParsedResults?.[0]?.ParsedText?.trim()
  if (!parsedText) {
    const message = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join(", ") : data.ErrorMessage
    throw new Error(message ?? "OCR.Space response missing text")
  }

  return parsedText
}

export interface IngestImageOptions {
  userId: string
  contentId: string
  sourceName?: string | null
  sourceUrl?: string | null
  buffer: Buffer
  fileName?: string
  mimeType?: string
  mode?: "ocr" | "clip"
}

export async function processAndIndexImage(options: IngestImageOptions): Promise<{ cloudinaryUrl: string; modality: string; mode: string }> {
  const { userId, contentId, sourceName = "image", sourceUrl, buffer, fileName = "image.jpg", mimeType = "image/jpeg", mode = "clip" } = options

  // 1. Upload original file to Cloudinary
  let cloudinaryUrl = sourceUrl || ""
  if (config.cloudinaryCloudName && config.cloudinaryApiKey && config.cloudinaryApiSecret) {
    try {
      const cld = await uploadToCloudinary(buffer, sourceName || "image", "image")
      cloudinaryUrl = cld.url
    } catch (err) {
      console.warn("Cloudinary image upload fallback:", err)
    }
  }

  if (mode === "ocr") {
    // Mode OCR: OCR text extraction -> Groq text embedding (768-dim) -> rag_text
    const extractedText = await extractOcrText(buffer, fileName)
    const textVec = await embedText(extractedText, "RETRIEVAL_DOCUMENT")
    const pointId = randomUUID()

    await upsertChunk(pointId, textVec, {
      contentId,
      userId,
      sourceType: "image",
      sourceUrl: sourceUrl || cloudinaryUrl,
      sourceName,
      sourceTitle: sourceName,
      cloudinaryUrl,
      modality: "image",
      chunkIndex: 0,
      text: extractedText,
    })
  } else {
    // Mode CLIP: CLIP sidecar vector (512-dim) -> rag_images + Tag description vector (768-dim Groq) -> rag_text
    let clipVector: number[]
    let tags: string[]
    try {
      ;[clipVector, tags] = await Promise.all([
        embedImage(buffer, mimeType),
        tagImage(buffer, mimeType).catch(() => []),
      ])
    } catch (err) {
      // Re-thrown as the same typed error (not wrapped in a generic Error)
      // so callers can distinguish "CLIP sidecar isn't running" — a 503,
      // the service is just down — from other failures that stay a 500.
      if (err instanceof ClipSidecarUnavailableError) {
        console.warn(`processAndIndexImage: CLIP sidecar unavailable while indexing "${fileName}"`)
      }
      throw err
    }

    // A flowing sentence, not a labeled field dump — this is what gets
    // embedded and later shown to the LLM as retrieved context, and the
    // model tends to mirror the shape of what it's given.
    const titledAs = sourceName ? ` titled "${sourceName}"` : ""
    const caption = tags.length
      ? `A photo${titledAs} showing ${joinNaturally(tags)}.`
      : `An uploaded photo${titledAs} with no clearly recognizable subject.`
    const tagText = caption

    // Upsert 512-dim CLIP vector to rag_images
    const imgPointId = randomUUID()
    await upsertImageVector(imgPointId, clipVector, {
      contentId,
      userId,
      sourceType: "image",
      sourceUrl: sourceUrl || cloudinaryUrl,
      sourceName,
      sourceTitle: sourceName,
      cloudinaryUrl,
      modality: "image",
      tags,
      caption,
      chunkIndex: 0,
      text: tagText,
    })

    // Upsert 768-dim Groq text description vector to rag_text
    const textVec = await embedText(tagText, "RETRIEVAL_DOCUMENT")
    const txtPointId = randomUUID()
    await upsertChunk(txtPointId, textVec, {
      contentId: `${contentId}-tagdesc`,
      userId,
      sourceType: "image",
      sourceUrl: sourceUrl || cloudinaryUrl,
      sourceName,
      sourceTitle: sourceName,
      cloudinaryUrl,
      modality: "image",
      tags,
      caption,
      chunkIndex: 0,
      text: tagText,
    })
  }

  return { cloudinaryUrl, modality: "image", mode }
}
