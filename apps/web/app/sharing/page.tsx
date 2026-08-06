"use client"
import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useSelector } from "react-redux"
import type { RootState } from "@/store/store"
import SideBar from "@/components/SideBar"
import type { ContentItem } from "@secondbrain/types"
import toast, { Toaster } from "react-hot-toast"

interface SharedNote extends ContentItem {
  shareLink: string | null
  isExpired: boolean
}

const TYPE_ICON:  Record<string, string> = { article: "📄", image: "🖼", audio: "🎵", video: "🎬" }
const TYPE_COLOR: Record<string, string> = { article: "#6366f1", image: "#ec4899", audio: "#f59e0b", video: "#10b981" }

function timeRemaining(expiresAt: string | Date | null | undefined): string {
  if (!expiresAt) return "No expiry"
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return "Expired"
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const mins  = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const rem  = hours % 24
    return `${days}d ${rem}h left`
  }
  return `${hours}h ${mins}m left`
}

export default function SharingDashboard() {
  const router = useRouter()
  const layout = useSelector((s: RootState) => s.theme.layout)
  const [notes,   setNotes]   = useState<SharedNote[]>([])
  const [loading, setLoading] = useState(true)

  // Extend modal
  const [extendId,       setExtendId]       = useState<string | null>(null)
  const [extendDuration, setExtendDuration] = useState<"1h" | "1d" | "custom">("1d")
  const [extendDays,     setExtendDays]     = useState(7)

  const fetchNotes = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/sharing")
      if (res.ok) setNotes(await res.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchNotes() }, [fetchNotes])

  // Live countdown every 30s
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000)
    return () => clearInterval(interval)
  }, [])

  const disableShare = async (noteId: string) => {
    const res = await fetch(`/api/content/${noteId}/share`, { method: "DELETE" })
    if (res.ok) {
      setNotes((p) => p.filter((n) => n.id !== noteId))
      toast.success("Sharing disabled")
    } else {
      toast.error("Failed to disable sharing")
    }
  }

  const extendShare = async () => {
    if (!extendId) return
    const body: { duration: string; days?: number } = { duration: extendDuration }
    if (extendDuration === "custom") body.days = extendDays

    const res = await fetch(`/api/content/${extendId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      toast.success("Share link extended!")
      setExtendId(null)
      fetchNotes()
    } else {
      const d = await res.json()
      toast.error(d.error ?? "Failed")
    }
  }

  const copyLink = async (link: string) => {
    await navigator.clipboard.writeText(link)
    toast.success("Link copied!")
  }

  const gridCols = layout === "compact" ? "grid-cols-3" : layout === "spacious" ? "grid-cols-1" : "grid-cols-2"

  const activeNotes  = notes.filter((n) => !n.isExpired)
  const expiredNotes = notes.filter((n) => n.isExpired)

  return (
    <div className="h-dvh w-dvw flex overflow-hidden transition-colors duration-300" style={{ background: "var(--bg-primary)" }}>
      <div className="w-[220px] flex-shrink-0 h-full"><SideBar /></div>
      <Toaster position="bottom-right" reverseOrder />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>My Shared Links</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Manage all notes you&apos;ve shared via public link</p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64 gap-3">
              <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading shared notes...</p>
            </div>
          ) : notes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 opacity-50">
              <span className="text-5xl">📤</span>
              <p className="text-lg font-medium" style={{ color: "var(--text-secondary)" }}>No shared notes yet</p>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>When you enable sharing on a note, it will appear here</p>
            </div>
          ) : (
            <>
              {/* Active shares */}
              {activeNotes.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-sm font-semibold uppercase tracking-wider mb-4 flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    Active ({activeNotes.length})
                  </h2>
                  <div className={`grid ${gridCols} gap-4`}>
                    {activeNotes.map((note) => {
                      const color = TYPE_COLOR[note.type] ?? "#e1434b"
                      const icon  = TYPE_ICON[note.type]  ?? "📝"
                      const remaining = timeRemaining(note.shareExpiresAt)

                      return (
                        <div key={note.id} className="rounded-xl border overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5" style={{ background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "var(--shadow)" }}>
                          <div className="h-1.5 w-full flex-shrink-0" style={{ background: color }} />
                          <div className="p-4 flex-1 flex flex-col">
                            <div className="flex items-center gap-2 mb-2">
                              <span>{icon}</span>
                              <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full text-white" style={{ background: color }}>{note.type}</span>
                              <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>● Live</span>
                            </div>
                            <h3 className="text-sm font-semibold mb-1 line-clamp-2 cursor-pointer hover:underline" style={{ color: "var(--text-primary)" }} onClick={() => router.push(`/note/${note.id}`)}>{note.title}</h3>

                            {/* Expiry countdown */}
                            <div className="flex items-center gap-1.5 mt-2 mb-3">
                              <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--text-muted)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{remaining}</span>
                            </div>

                            {/* Share link */}
                            {note.shareLink && (
                              <div className="flex items-center gap-1.5 mb-3">
                                <input type="text" readOnly value={note.shareLink} className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border truncate focus:outline-none" style={{ background: "var(--input-bg)", borderColor: "var(--border)", color: "var(--text-secondary)" }} />
                                <button onClick={() => copyLink(note.shareLink!)} className="flex-shrink-0 px-2.5 py-1.5 text-xs text-white rounded-lg font-medium hover:opacity-90 transition-opacity" style={{ background: "#6366f1" }} title="Copy link">📋</button>
                              </div>
                            )}

                            {/* Actions */}
                            <div className="flex items-center gap-2 mt-auto">
                              <button onClick={() => { setExtendId(note.id); setExtendDuration("1d"); setExtendDays(7) }} className="flex-1 py-1.5 text-xs font-medium rounded-lg border transition-all hover:opacity-80" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                                ⏳ Extend
                              </button>
                              <button onClick={() => disableShare(note.id)} className="flex-1 py-1.5 text-xs font-medium text-white rounded-lg transition-all hover:opacity-90" style={{ background: "#ef4444" }}>
                                ✕ Turn Off
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Expired shares */}
              {expiredNotes.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider mb-4 flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                    <span className="w-2 h-2 rounded-full bg-gray-400" />
                    Expired ({expiredNotes.length})
                  </h2>
                  <div className={`grid ${gridCols} gap-4`}>
                    {expiredNotes.map((note) => {
                      const color = TYPE_COLOR[note.type] ?? "#e1434b"
                      const icon  = TYPE_ICON[note.type]  ?? "📝"

                      return (
                        <div key={note.id} className="rounded-xl border overflow-hidden flex flex-col opacity-60" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
                          <div className="h-1.5 w-full flex-shrink-0" style={{ background: color, opacity: 0.4 }} />
                          <div className="p-4 flex-1 flex flex-col">
                            <div className="flex items-center gap-2 mb-2">
                              <span>{icon}</span>
                              <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full text-white" style={{ background: color, opacity: 0.6 }}>{note.type}</span>
                              <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(156,163,175,0.15)", color: "#9ca3af" }}>Expired</span>
                            </div>
                            <h3 className="text-sm font-semibold mb-3 line-clamp-2 cursor-pointer hover:underline" style={{ color: "var(--text-primary)" }} onClick={() => router.push(`/note/${note.id}`)}>{note.title}</h3>
                            <div className="flex items-center gap-2 mt-auto">
                              <button onClick={() => { setExtendId(note.id); setExtendDuration("1d"); setExtendDays(7) }} className="flex-1 py-1.5 text-xs font-medium rounded-lg border transition-all hover:opacity-80" style={{ borderColor: "#22c55e", color: "#22c55e" }}>
                                🔄 Re-enable
                              </button>
                              <button onClick={() => disableShare(note.id)} className="flex-1 py-1.5 text-xs font-medium rounded-lg border transition-all hover:opacity-80" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                                🗑 Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Extend modal */}
      {extendId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setExtendId(null)}>
          <div className="rounded-2xl p-6 max-w-sm w-full shadow-2xl" style={{ background: "var(--bg-card)" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-1" style={{ color: "var(--text-primary)" }}>Extend Share Link</h2>
            <p className="text-sm mb-5" style={{ color: "var(--text-muted)" }}>Choose a new duration for this share link</p>

            <div className="flex flex-col gap-2 mb-5">
              {([["1h", "1 Hour"], ["1d", "1 Day"], ["custom", "Custom"]] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setExtendDuration(val)}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-sm font-medium text-left transition-all"
                  style={{
                    borderColor: extendDuration === val ? "var(--accent)" : "var(--border)",
                    background:  extendDuration === val ? "var(--accent)" : "var(--bg-card)",
                    color:       extendDuration === val ? "#fff" : "var(--text-primary)",
                  }}
                >
                  <span>{val === "1h" ? "⏰" : val === "1d" ? "📅" : "🔧"}</span>
                  {label}
                </button>
              ))}
            </div>

            {extendDuration === "custom" && (
              <div className="mb-5">
                <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Number of days</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={extendDays}
                  onChange={(e) => setExtendDays(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full h-10 px-3 rounded-xl border text-sm focus:outline-none"
                  style={{ background: "var(--input-bg)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                />
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={extendShare} className="flex-1 py-2.5 text-sm text-white rounded-xl font-medium hover:opacity-90 transition-opacity" style={{ background: "var(--accent)" }}>
                Confirm
              </button>
              <button onClick={() => setExtendId(null)} className="flex-1 py-2.5 text-sm rounded-xl font-medium border" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
