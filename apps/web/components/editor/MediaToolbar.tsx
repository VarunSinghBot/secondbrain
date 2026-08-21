"use client"

import { useState, useRef, type RefObject } from "react"
import type { MediaTool } from "@/lib/editor"
import toast from "react-hot-toast"
import { Image as ImageIcon, Music, Video, FolderOpen, Link2, UploadCloud, Loader2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"

type MediaToolbarButton = {
  tool: MediaTool
  label: string
  accept: string
  icon: LucideIcon
}

export default function MediaToolbar({
  activeMediaTool,
  mediaInput,
  mediaInputRef,
  onOpenTool,
  onMediaInputChange,
  onConfirmInsert,
  onDirectUpload,
}: {
  activeMediaTool: MediaTool | null
  mediaInput: string
  mediaInputRef: RefObject<HTMLInputElement | null>
  onOpenTool: (tool: MediaTool) => void
  onMediaInputChange: (value: string) => void
  onConfirmInsert: () => void
  onDirectUpload?: (url: string, tool: MediaTool) => void
}) {
  const [tab, setTab] = useState<"file" | "url">("file")
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const mediaButtons: MediaToolbarButton[] = [
    { tool: "image", label: "Image", accept: "image/*", icon: ImageIcon },
    { tool: "audio", label: "Audio", accept: "audio/*", icon: Music },
    { tool: "video", label: "Video", accept: "video/*", icon: Video },
  ]

  const currentButton = mediaButtons.find((b) => b.tool === activeMediaTool)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !activeMediaTool) return

    setUploading(true)
    const toastId = toast.loading(`Uploading ${activeMediaTool} to Cloudinary...`)

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("folder", `secondbrain/${activeMediaTool}s`)

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Upload failed")

      toast.success(`${file.name} uploaded!`, { id: toastId })
      if (onDirectUpload) {
        onDirectUpload(data.url, activeMediaTool)
      } else {
        onMediaInputChange(data.url)
        onConfirmInsert()
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Upload failed", { id: toastId })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <>
      {mediaButtons.map(({ tool, label, icon: Icon }) => (
        <div key={tool} className="relative">
          <button
            onMouseDown={(e) => {
              e.preventDefault()
              onOpenTool(tool)
            }}
            className="px-3 h-8 rounded text-xs transition-all hover:opacity-70 font-medium flex items-center gap-1.5"
            style={{
              color: "var(--text-primary)",
              background: activeMediaTool === tool ? "var(--accent)" : "var(--input-bg)",
            }}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={2} />
            {label}
          </button>

          {activeMediaTool === tool && (
            <div
              className="absolute left-0 top-full z-20 mt-2 w-80 rounded-xl border p-3 shadow-xl"
              style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
            >
              {/* Tab Selector */}
              <div className="flex border-b mb-3" style={{ borderColor: "var(--border)" }}>
                <button
                  type="button"
                  onClick={() => setTab("file")}
                  className={`flex-1 py-1.5 text-xs font-semibold border-b-2 transition-all flex items-center justify-center gap-1.5 ${
                    tab === "file" ? "border-red-500" : "border-transparent text-gray-400"
                  }`}
                  style={{ color: tab === "file" ? "var(--accent)" : "var(--text-muted)" }}
                >
                  <FolderOpen className="w-3.5 h-3.5" /> Upload File
                </button>
                <button
                  type="button"
                  onClick={() => setTab("url")}
                  className={`flex-1 py-1.5 text-xs font-semibold border-b-2 transition-all flex items-center justify-center gap-1.5 ${
                    tab === "url" ? "border-red-500" : "border-transparent text-gray-400"
                  }`}
                  style={{ color: tab === "url" ? "var(--accent)" : "var(--text-muted)" }}
                >
                  <Link2 className="w-3.5 h-3.5" /> Paste URL
                </button>
              </div>

              {tab === "file" ? (
                <div className="space-y-2">
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Select a local {tool} file to upload to Cloudinary:
                  </p>
                  <label
                    className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-lg cursor-pointer transition-colors"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--input-bg)",
                    }}
                  >
                    {uploading ? (
                      <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--accent)" }}>
                        <Loader2 className="w-4 h-4 animate-spin" /> Uploading...
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center pt-2 pb-2">
                        <UploadCloud className="w-5 h-5 mb-1" style={{ color: "var(--text-muted)" }} strokeWidth={1.75} />
                        <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                          Click to browse file
                        </p>
                        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                          Supports {currentButton?.accept}
                        </p>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={currentButton?.accept}
                      onChange={handleFileChange}
                      disabled={uploading}
                      className="hidden"
                    />
                  </label>
                </div>
              ) : (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                    Paste {currentButton?.label.toLowerCase()} URL
                  </p>
                  <div className="flex gap-2">
                    <input
                      ref={mediaInputRef}
                      type="text"
                      value={mediaInput}
                      onChange={(e) => onMediaInputChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          onConfirmInsert()
                        }
                      }}
                      placeholder="https://..."
                      className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none"
                      style={{
                        background: "var(--input-bg)",
                        borderColor: "var(--border)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <button
                      type="button"
                      onClick={onConfirmInsert}
                      className="rounded-lg px-3 py-2 text-sm font-medium text-white transition-all hover:shadow"
                      style={{ background: "var(--accent)" }}
                    >
                      Insert
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  )
}