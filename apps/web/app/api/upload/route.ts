import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { uploadToCloudinary } from "@/lib/cloudinary"

// Matches the pickers' own `accept` attributes (MediaToolbar.tsx) — that
// attribute only filters what a native OS file dialog shows, and does
// nothing at all against setInputFiles-style automation or a hand-built
// upload request, so the real check has to happen here.
const ALLOWED_MIME: Record<string, (mime: string) => boolean> = {
  image:    (m) => m.startsWith("image/"),
  audio:    (m) => m.startsWith("audio/"),
  video:    (m) => m.startsWith("video/"),
  document: (m) => m === "application/pdf",
  avatar:   (m) => m.startsWith("image/"),
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const folder = (formData.get("folder") as string) || "secondbrain"
    const mediaType = formData.get("mediaType") as string | null

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })

    const mimeType = file.type || "application/octet-stream"

    if (mediaType) {
      const isAllowed = ALLOWED_MIME[mediaType]
      if (!isAllowed) return NextResponse.json({ error: `Unknown media type: ${mediaType}` }, { status: 400 })
      if (!isAllowed(mimeType)) {
        const article = /^[aeiou]/i.test(mediaType) ? "an" : "a"
        return NextResponse.json(
          { error: `This doesn't look like ${article} ${mediaType} file (got "${mimeType}"). Please choose a real ${mediaType} file.` },
          { status: 400 }
        )
      }
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const result = await uploadToCloudinary(buffer, mimeType, folder, file.name)

    return NextResponse.json({
      url: result.secure_url,
      public_id: result.public_id,
      resource_type: result.resource_type,
      format: result.format,
      name: file.name,
    })
  } catch (e: unknown) {
    console.error("Cloudinary upload error:", e)
    const message = e instanceof Error ? e.message : "Upload failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

