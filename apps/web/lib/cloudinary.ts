import { v2 as cloudinary, UploadApiResponse } from "cloudinary"

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

export type CloudinaryUploadResult = UploadApiResponse

export async function uploadToCloudinary(
  buffer: Buffer,
  mimeType: string,
  folder = "secondbrain",
  fileName?: string
): Promise<UploadApiResponse> {
  const resourceType = mimeType.startsWith("video/")
    ? "video"
    : mimeType.startsWith("audio/")
      ? "video" // Cloudinary handles audio files under resource_type "video"
      : mimeType.startsWith("image/")
        ? "image"
        // "auto" was here before — for a PDF, Cloudinary's own detection
        // classifies that as resource_type "image" (so it can render page
        // thumbnails), which since ~2023 Cloudinary blocks from
        // unauthenticated delivery by default (401 on GET), breaking both
        // rag-backend's own downloadUrl() and LlamaParse's server-side
        // fetch of the same URL. "raw" serves the file byte-for-byte with
        // no such restriction — matches what rag-backend's own
        // uploadToCloudinary() call already uses for non-image/video/audio
        // sourceTypes (services/indexer.ts).
        : "raw"

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType,
        folder,
        // Uploading from an in-memory Buffer (not a real file path), so
        // Cloudinary has no filename/extension to draw from unless told —
        // without this, a raw-resource URL (PDFs/documents) comes back with
        // no extension at all (e.g. ".../documents/abc123", no ".pdf"),
        // which LlamaParse's source_url parameter rejects outright (422
        // Unprocessable Entity — confirmed live). Only matters for `raw`
        // (image/video resources already get their format appended
        // separately by Cloudinary), but passing it unconditionally is
        // harmless.
        ...(fileName ? { use_filename: true, unique_filename: true, filename_override: fileName } : {}),
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary upload failed with empty response"))
        } else {
          resolve(result)
        }
      }
    )
    uploadStream.end(buffer)
  })
}

export default cloudinary

