import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"

import { downloadUrl } from "./download"
import { extractImageText } from "./ocr"
import { transcribeAudio } from "./groq"

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

export async function extractVideoText(sourceUrl: string): Promise<string> {
  const { buffer } = await downloadUrl(sourceUrl)
  const tempDir = await mkdtemp(join(tmpdir(), "secondbrain-video-"))
  const videoPath = join(tempDir, "video.bin")
  const audioPath = join(tempDir, "audio.wav")
  const framePath = join(tempDir, "frame.jpg")

  try {
    await writeFile(videoPath, buffer)
    await runFfmpeg(["-y", "-i", videoPath, "-vn", "-acodec", "pcm_s16le", audioPath])
    await runFfmpeg(["-y", "-i", videoPath, "-ss", "00:00:01.000", "-vframes", "1", framePath])

    const audioBuffer = await readFile(audioPath)
    const frameBuffer = await readFile(framePath)

    const transcript = await transcribeAudio(audioBuffer, "video-audio.wav")
    const frameText = await extractImageText(frameBuffer, "video-frame.jpg").catch(() => "")

    return [transcript, frameText].filter(Boolean).join("\n\n")
  } finally {
    await Promise.allSettled([
      unlink(videoPath),
      unlink(audioPath),
      unlink(framePath),
    ])
  }
}