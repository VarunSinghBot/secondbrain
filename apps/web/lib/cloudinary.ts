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
  folder = "secondbrain"
): Promise<UploadApiResponse> {
  const resourceType = mimeType.startsWith("video/")
    ? "video"
    : mimeType.startsWith("audio/")
    ? "video" // Cloudinary handles audio files under resource_type "video"
    : mimeType.startsWith("image/")
    ? "image"
    : "auto"

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType,
        folder,
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

