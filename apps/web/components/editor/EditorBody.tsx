"use client"

import { useState, type RefObject, type DragEvent } from "react"
import toast from "react-hot-toast"
import type { MediaTool } from "@/lib/editor"

export default function EditorBody({
  bodyRef,
  onInput,
  onKeyUp,
  onMouseUp,
  onFocus,
  onDropMedia,
}: {
  bodyRef: RefObject<HTMLDivElement | null>
  onInput: () => void
  onKeyUp: () => void
  onMouseUp: () => void
  onFocus: () => void
  onDropMedia?: (url: string, tool: MediaTool) => void
}) {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    for (const file of files) {
      let mediaTool: MediaTool = "image"
      if (file.type.startsWith("video/")) mediaTool = "video"
      else if (file.type.startsWith("audio/")) mediaTool = "audio"
      else if (!file.type.startsWith("image/")) {
        toast.error(`Unsupported file type: ${file.type || file.name}`)
        continue
      }

      const toastId = toast.loading(`Uploading ${file.name} to Cloudinary...`)

      try {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("folder", `secondbrain/${mediaTool}s`)

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        })

        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Upload failed")

        toast.success(`Dropped ${file.name} uploaded!`, { id: toastId })
        if (onDropMedia) {
          onDropMedia(data.url, mediaTool)
        }
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Upload failed", { id: toastId })
      }
    }
  }

  return (
    <div className="relative min-h-[400px]">
      {isDragging && (
        <div
          className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 backdrop-blur-sm transition-all"
          style={{
            borderColor: "var(--accent)",
            background: "rgba(0, 0, 0, 0.4)",
          }}
        >
          <span className="text-4xl mb-2 animate-bounce">☁️</span>
          <p className="text-lg font-bold text-white">Drop media here to upload to Cloudinary</p>
          <p className="text-xs text-gray-200 mt-1">Supports Images, Audio, and Video files</p>
        </div>
      )}

      <div
        ref={bodyRef}
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Tell your story... (Drag & drop images, audio, or video here)"
        onInput={onInput}
        onKeyUp={onKeyUp}
        onMouseUp={onMouseUp}
        onFocus={onFocus}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="editor-body min-h-[400px] text-lg leading-8 focus:outline-none"
        style={{ color: "var(--text-primary)", fontFamily: "Georgia, serif" }}
      />
    </div>
  )
}

