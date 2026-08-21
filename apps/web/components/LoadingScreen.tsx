"use client"

import { Brain } from "lucide-react"

export default function LoadingScreen({
  label = "Loading...",
  fullScreen = true,
}: {
  label?: string
  fullScreen?: boolean
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-4 ${fullScreen ? "h-dvh w-full" : "py-14 w-full"}`}
      style={{ background: fullScreen ? "var(--bg-primary)" : "transparent" }}
    >
      <div className="relative h-14 w-14">
        {/* Spinning ring */}
        <div
          className="absolute inset-0 rounded-full border-[3px] animate-spin"
          style={{ borderColor: "var(--border)", borderTopColor: "var(--accent)" }}
        />
        {/* Pulsing brain mark, matches the sidebar logo */}
        <div className="absolute inset-0 flex items-center justify-center">
          <Brain className="w-6 h-6 animate-pulse" style={{ color: "var(--accent)" }} strokeWidth={2} />
        </div>
      </div>
      <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
    </div>
  )
}