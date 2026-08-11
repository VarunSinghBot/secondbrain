import { createHash } from "node:crypto"
import { config, requireConfig } from "./config"

export interface CloudinaryUploadResult {
  url: string
  publicId: string
  format?: string
  resourceType: string
}

export async function uploadToCloudinary(
  fileBuffer: Buffer,
  fileName: string,
  resourceType: "image" | "video" | "raw" | "auto" = "auto"
): Promise<CloudinaryUploadResult> {
  const cloudName = requireConfig(config.cloudinaryCloudName, "CLOUDINARY_CLOUD_NAME")
  const apiKey = requireConfig(config.cloudinaryApiKey, "CLOUDINARY_API_KEY")
  const apiSecret = requireConfig(config.cloudinaryApiSecret, "CLOUDINARY_API_SECRET")

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const folder = "multimodal_rag"

  // Create signature for Cloudinary signed upload
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`
  const signature = createHash("sha1").update(paramsToSign).digest("hex")

  const formData = new FormData()
  formData.append("file", new Blob([fileBuffer]), fileName)
  formData.append("api_key", apiKey)
  formData.append("timestamp", timestamp)
  formData.append("folder", folder)
  formData.append("signature", signature)

  const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`

  const response = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Cloudinary upload failed (${response.status}): ${errText}`)
  }

  const data = (await response.json()) as {
    secure_url: string
    public_id: string
    format?: string
    resource_type: string
  }

  return {
    url: data.secure_url,
    publicId: data.public_id,
    format: data.format,
    resourceType: data.resource_type,
  }
}
