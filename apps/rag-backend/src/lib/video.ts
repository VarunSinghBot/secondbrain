import { mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"

import { downloadUrl } from "./download"
import { transcribeAudio } from "./groq"
import { embedImage, tagImage } from "./clip-client"
import { chunkText } from "./text"
import { embedText } from "./embeddings"
import { upsertChunk, upsertImageVector } from "./qdrant"
import { uploadToCloudinary } from "./cloudinary"
import { config } from "./config"

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: "ignore" })
    proc.on("error", reject)
    proc.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code ?? "unknown"}`))
    })
  })
}

export interface IngestVideoOptions {
  userId: string
  contentId: string
  sourceName?: string | null
  sourceUrl: string
  buffer?: Buffer
  maxFrames?: number
}

export async function processAndIndexVideo(options: IngestVideoOptions): Promise<{ cloudinaryUrl: string; indexedAudioChunks: number; indexedFrames: number }> {
  const { userId, contentId, sourceName = "video", sourceUrl, buffer: providedBuffer, maxFrames = 10 } = options

  const videoBuffer = providedBuffer || (await downloadUrl(sourceUrl)).buffer

  let cloudinaryUrl = sourceUrl
  if (config.cloudinaryCloudName && config.cloudinaryApiKey && config.cloudinaryApiSecret) {
    try {
      const cld = await uploadToCloudinary(videoBuffer, sourceName || "video", "video")
      cloudinaryUrl = cld.url
    } catch (err) {
      console.warn("Cloudinary video upload fallback:", err)
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), "secondbrain-video-"))
  const videoPath = join(tempDir, "video.bin")
  const audioPath = join(tempDir, "audio.wav")

  let indexedAudioChunks = 0
  let indexedFrames = 0

  try {
    await writeFile(videoPath, videoBuffer)

    const hasAudio = await runFfmpeg(["-y", "-i", videoPath, "-vn", "-acodec", "pcm_s16le", audioPath])
      .then(() => true)
      .catch(() => false)

    if (hasAudio) {
      try {
        const audioBuffer = await readFile(audioPath)
        const transcript = await transcribeAudio(audioBuffer, "video-audio.wav")
        if (transcript.trim()) {
          const textChunks = chunkText(transcript)
          for (let i = 0; i < textChunks.length; i++) {
            const chunkObj = textChunks[i]
            const chunkTextContent = chunkObj.text
            const embedding = await embedText(chunkTextContent, "RETRIEVAL_DOCUMENT")
            const pointId = randomUUID()
            await upsertChunk(pointId, embedding, {
              contentId,
              userId,
              sourceType: "video",
              sourceUrl,
              sourceName,
              sourceTitle: sourceName,
              cloudinaryUrl,
              modality: "video_audio",
              chunkIndex: i,
              text: chunkTextContent,
            })
            indexedAudioChunks++
          }
        }
      } catch (err) {
        console.warn("Video audio transcription failed or empty:", err)
      }
    }

    const framePattern = join(tempDir, "frame_%03d.jpg")
    await runFfmpeg([
      "-y",
      "-i",
      videoPath,
      "-vf",
      `select='not(mod(n\\,max(1\\,trunc(n_frames/${maxFrames}))))'`,
      "-vsync",
      "vfr",
      "-q:v",
      "2",
      framePattern,
    ]).catch(() => {})

    const files = await readdir(tempDir)
    const frameFiles = files.filter((f) => f.startsWith("frame_") && f.endsWith(".jpg")).sort().slice(0, maxFrames)

    for (let idx = 0; idx < frameFiles.length; idx++) {
      const fName = frameFiles[idx]
      const fPath = join(tempDir, fName)
      const frameBuffer = await readFile(fPath)

      try {
        const [clipVec, tags] = await Promise.all([
          embedImage(frameBuffer, "image/jpeg"),
          tagImage(frameBuffer, "image/jpeg", 0.18, 8).catch(() => []),
        ])

        const caption = tags.length ? `Video frame ${idx} containing: ${tags.join(", ")}` : `Video frame ${idx}`
        const tagText = `Video frame ${idx}. Tags: ${tags.join(", ") || "none"}. Source: ${cloudinaryUrl}`

        const imgPointId = randomUUID()
        await upsertImageVector(imgPointId, clipVec, {
          contentId: `${contentId}-frame-${idx}`,
          userId,
          sourceType: "video",
          sourceUrl: `${cloudinaryUrl}#frame_${idx}`,
          sourceName: `${sourceName} (Frame ${idx})`,
          sourceTitle: sourceName,
          cloudinaryUrl,
          modality: "video_frame",
          tags,
          caption,
          chunkIndex: idx,
          text: tagText,
        })

        const textVec = await embedText(tagText, "RETRIEVAL_DOCUMENT")
        const txtPointId = randomUUID()
        await upsertChunk(txtPointId, textVec, {
          contentId: `${contentId}-frame-${idx}-desc`,
          userId,
          sourceType: "video",
          sourceUrl: `${cloudinaryUrl}#frame_${idx}`,
          sourceName: `${sourceName} (Frame ${idx})`,
          sourceTitle: sourceName,
          cloudinaryUrl,
          modality: "video_frame",
          tags,
          chunkIndex: idx,
          text: tagText,
        })

        indexedFrames++
      } catch (frameErr) {
        console.warn(`Failed to process frame ${idx}:`, frameErr)
      }
    }

    return { cloudinaryUrl, indexedAudioChunks, indexedFrames }
  } finally {
    try {
      const files = await readdir(tempDir)
      await Promise.all(files.map((f) => unlink(join(tempDir, f)).catch(() => {})))
    } catch {}
  }
}