import { mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"

import { downloadUrl } from "./download"
import { transcribeAudio } from "./groq"
import { embedImage, tagImage } from "./clip-client"
import { chunkText, joinNaturally } from "./text"
import { embedText } from "./embeddings"
import { upsertChunk, upsertImageVector } from "./qdrant"
import { uploadToCloudinary } from "./cloudinary"
import { config } from "./config"

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString() })
    proc.on("error", (err) => {
      reject(new Error(`Could not start ffmpeg (is it installed and on PATH for this process?): ${err.message}`))
    })
    proc.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code ?? "unknown"}${stderr ? `: ${stderr.trim().slice(-500)}` : " (no stderr output)"}`))
    })
  })
}

// CLIP embeddings from the sidecar are already L2-normalized, so a plain dot
// product would do — this stays a full cosine calculation so correctness
// doesn't silently depend on that upstream normalization detail.
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// ffprobe ships alongside ffmpeg (same apt/brew package), used here only to
// learn the video's duration so keyframes can be timestamped and sampled at
// even wall-clock intervals rather than even frame-count intervals.
async function getVideoDurationSeconds(videoPath: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let stdout = ""
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ])
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString() })
    proc.on("error", reject)
    proc.on("exit", (code) => {
      const seconds = Number.parseFloat(stdout.trim())
      if (code === 0 && Number.isFinite(seconds) && seconds > 0) resolve(seconds)
      else reject(new Error(`ffprobe failed to read duration (exit ${code ?? "unknown"})`))
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
  const { userId, contentId, sourceName = "video", sourceUrl, buffer: providedBuffer, maxFrames = config.maxVideoFrames } = options

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
      .catch((err) => {
        console.warn("Video audio-track extraction failed (treating as no audio):", err)
        return false
      })

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

    // Sample at fps = maxFrames/duration so frames land at even wall-clock
    // intervals across the whole video (not even frame-count intervals,
    // which drift on variable-frame-rate content) — this is what lets each
    // frame get an accurate timestampSeconds below.
    const durationSeconds = await getVideoDurationSeconds(videoPath).catch((err) => {
      console.warn("Video keyframe sampling skipped — ffprobe could not read duration:", err)
      return 0
    })

    const framePattern = join(tempDir, "frame_%03d.jpg")
    if (durationSeconds > 0) {
      await runFfmpeg([
        "-y",
        "-i",
        videoPath,
        "-vf",
        `fps=${maxFrames}/${durationSeconds}`,
        // -vsync was removed in recent ffmpeg builds (replaced by
        // -fps_mode) — this call was silently failing with "Unrecognized
        // option 'vsync'" before this fix, meaning keyframe extraction
        // never actually produced any frames on a current ffmpeg.
        "-fps_mode",
        "vfr",
        "-q:v",
        "2",
        framePattern,
      ]).catch((err) => console.warn("Video keyframe extraction (ffmpeg) failed:", err))
    }

    const files = await readdir(tempDir)
    const frameFiles = files.filter((f) => f.startsWith("frame_") && f.endsWith(".jpg")).sort().slice(0, maxFrames)
    // Frames are evenly spaced across the actual duration regardless of how
    // many ffmpeg produced (fps rounding can be off by one frame either way).
    const frameInterval = frameFiles.length > 0 ? durationSeconds / frameFiles.length : 0

    // CLIP embeddings of frames already kept from this video, this run — used
    // to drop near-duplicate frames (a static/slow-moving video otherwise
    // fills most of maxVideoFrames with near-identical content, see
    // config.videoFrameDedupeThreshold).
    const keptFrameEmbeddings: number[][] = []
    let duplicateFramesSkipped = 0

    for (let idx = 0; idx < frameFiles.length; idx++) {
      const fName = frameFiles[idx]
      const fPath = join(tempDir, fName)
      const frameBuffer = await readFile(fPath)
      const timestampSeconds = Math.round(idx * frameInterval)

      try {
        const clipVec = await embedImage(frameBuffer, "image/jpeg")

        const isDuplicate = keptFrameEmbeddings.some(
          (kept) => cosineSimilarity(clipVec, kept) >= config.videoFrameDedupeThreshold
        )
        if (isDuplicate) {
          duplicateFramesSkipped++
          continue
        }
        keptFrameEmbeddings.push(clipVec)

        const tags = await tagImage(frameBuffer, "image/jpeg").catch(() => [])

        // A flowing sentence, not a labeled field dump — this is what gets
        // embedded and later shown to the LLM as retrieved context, and the
        // model tends to mirror the shape of what it's given.
        const titledAs = sourceName ? ` from "${sourceName}"` : ""
        const caption = tags.length
          ? `A video frame${titledAs} showing ${joinNaturally(tags)}.`
          : `A video frame${titledAs} with no clearly recognizable subject.`
        const tagText = caption

        // contentId is the PARENT video's, unmodified (not a derived
        // per-frame id) — Task 5's deleteContentVectors(userId, contentId)
        // filters on an exact contentId match, so every frame must share it
        // to actually get cleaned up when the video is edited/re-indexed.
        // chunkIndex (not contentId) is what distinguishes individual frames,
        // same pattern already used for audio/PDF/text chunks.
        const imgPointId = randomUUID()
        await upsertImageVector(imgPointId, clipVec, {
          contentId,
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
          timestampSeconds,
        })

        const textVec = await embedText(tagText, "RETRIEVAL_DOCUMENT")
        const txtPointId = randomUUID()
        await upsertChunk(txtPointId, textVec, {
          contentId,
          userId,
          sourceType: "video",
          sourceUrl: `${cloudinaryUrl}#frame_${idx}`,
          sourceName: `${sourceName} (Frame ${idx})`,
          sourceTitle: sourceName,
          cloudinaryUrl,
          modality: "video_frame",
          tags,
          chunkIndex: idx,
          timestampSeconds,
          text: tagText,
        })

        indexedFrames++
      } catch (frameErr) {
        console.warn(`Failed to process frame ${idx}:`, frameErr)
      }
    }

    if (duplicateFramesSkipped > 0) {
      console.log(
        `Video ${contentId}: skipped ${duplicateFramesSkipped} of ${frameFiles.length} sampled frame(s) ` +
        `as near-duplicates (cosine >= ${config.videoFrameDedupeThreshold}) of an already-kept frame`
      )
    }

    if (indexedAudioChunks === 0 && indexedFrames === 0) {
      console.warn(
        `Video ${contentId} produced zero indexed content (no audio transcript, no frames) — ` +
        `this video has no searchable RAG content. Check the ffmpeg warnings above for the real ` +
        `cause (missing/unreachable ffmpeg binary, unsupported codec, or a genuinely silent video ` +
        `with no visual motion for keyframe sampling to catch).`
      )
    }

    return { cloudinaryUrl, indexedAudioChunks, indexedFrames }
  } finally {
    try {
      const files = await readdir(tempDir)
      await Promise.all(files.map((f) => unlink(join(tempDir, f)).catch(() => {})))
    } catch {}
  }
}