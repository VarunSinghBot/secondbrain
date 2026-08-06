"use client"

import type { ReactNode } from "react"
import type { ContentType } from "@/lib/editor"

type ToolbarButton = {
  label: string
  cmd: string
  cls?: string
  value?: string
}

export default function EditorToolbar({
  toolbar,
  blockBtns,
  children,
  type,
  onFormat,
  onTypeChange,
}: {
  toolbar: ToolbarButton[]
  blockBtns: ToolbarButton[]
  children: ReactNode
  type: ContentType
  onFormat: (cmd: string, value?: string) => void
  onTypeChange: (type: ContentType) => void
}) {
  return (
    <div className="flex items-center gap-1 px-6 py-2 border-b flex-shrink-0"
         style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
      {toolbar.map(({ label, cmd, cls }) => (
        <button key={cmd}
                onMouseDown={(e) => { e.preventDefault(); onFormat(cmd) }}
                className={`w-8 h-8 rounded flex items-center justify-center text-sm ${cls ?? ""} transition-all hover:opacity-70`}
                style={{ color: "var(--text-primary)", background: "var(--input-bg)" }}>
          {label}
        </button>
      ))}
      <div className="w-px h-5 mx-1" style={{ background: "var(--border)" }} />
      {blockBtns.map(({ label, cmd, value }) => (
        <button key={label}
                onMouseDown={(e) => { e.preventDefault(); onFormat(cmd, value) }}
                className="px-2 h-8 rounded text-xs transition-all hover:opacity-70"
                style={{ color: "var(--text-primary)", background: "var(--input-bg)" }}>
          {label}
        </button>
      ))}
      {children}
      <div className="w-px h-5 mx-1" style={{ background: "var(--border)" }} />
      <select value={type} onChange={(e) => onTypeChange(e.target.value as ContentType)}
              className="h-8 px-2 rounded text-xs border-0 cursor-pointer"
              style={{ background: "var(--input-bg)", color: "var(--text-primary)" }}>
        <option value="article">📄 Article</option>
        <option value="image">🖼 Image</option>
        <option value="audio">🎵 Audio</option>
        <option value="video">🎬 Video</option>
      </select>
    </div>
  )
}
