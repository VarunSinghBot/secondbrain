import { config, requireConfig } from "./config"

export async function extractImageText(buffer: Buffer, fileName = "image.png"): Promise<string> {
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

  const data = await response.json() as {
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