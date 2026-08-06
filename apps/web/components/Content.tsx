"use client"
import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useSelector } from "react-redux"
import type { RootState } from "@/store/store"
import type { ContentItem } from "@secondbrain/types"
import { getYouTubeEmbedUrl } from "@/lib/media"
import toast, { Toaster } from "react-hot-toast"

interface ContentProps { filterType: string | null; searchQuery: string }

const TYPE_ICON:  Record<string, string> = { article: "📄", image: "🖼", audio: "🎵", video: "🎬" }
const TYPE_COLOR: Record<string, string> = { article: "#6366f1", image: "#ec4899", audio: "#f59e0b", video: "#10b981" }

interface Friend { id: string; name: string | null; email: string | null }

export default function Content({ filterType, searchQuery }: ContentProps) {
  const router  = useRouter()
  const layout  = useSelector((s: RootState) => s.theme.layout)
  const [items,    setItems]    = useState<ContentItem[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [delId,    setDelId]    = useState<string | null>(null)
  const [shareId,  setShareId]  = useState<string | null>(null)
  const [friends,  setFriends]  = useState<Friend[]>([])
  const [shareLink, setShareLink] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const res = await fetch("/api/content")
        if (!res.ok) throw new Error("Failed to fetch")
        setItems(await res.json())
      } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error") }
      finally { setLoading(false) }
    })()
  }, [])

  useEffect(() => {
    if (shareId) {
      fetch("/api/friends").then((r) => r.json()).then((d) => Array.isArray(d) && setFriends(d)).catch(() => {})
    } else {
      setShareLink(null)
    }
  }, [shareId])

  const filtered = useMemo(() => {
    let result = items
    if (filterType)  result = result.filter((i) => i.type === filterType)
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result  = result.filter((i) =>
        i.title.toLowerCase().includes(q) ||
        i.body.toLowerCase().includes(q)  ||
        i.tags?.some((t) => t.tagName.toLowerCase().includes(q))
      )
    }
    return result
  }, [items, filterType, searchQuery])

  const del = async (id: string) => {
    await fetch(`/api/content/${id}`, { method: "DELETE" })
    setItems((p) => p.filter((i) => i.id !== id))
    setDelId(null)
  }

  const sharePublic = async (noteId: string) => {
    const res  = await fetch(`/api/content/${noteId}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ duration: "1d" }) })
    const data = await res.json()
    if (res.ok && data.shareLink) {
      setItems((prev) => prev.map((item) => item.id === noteId ? { ...item, shareEnabled: true, shareHash: data.shareHash, shareExpiresAt: data.shareExpiresAt } : item))
      await navigator.clipboard.writeText(data.shareLink)
      toast.success("Public link copied to clipboard (expires in 1 day)!")
      setShareId(null)
    } else {
      toast.error(data.error ?? "Failed to enable share link")
    }
  }

  const shareWithFriend = async (noteId: string, friendId: string) => {
    const res = await fetch(`/api/notes/${noteId}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "friend", friendId }) })
    if (res.ok) { toast.success("Note shared with friend!"); setShareId(null) }
    else { const d = await res.json(); toast.error(d.error ?? "Failed") }
  }

  const gridCols = layout === "compact" ? "grid-cols-4" : layout === "spacious" ? "grid-cols-2" : "grid-cols-3"

  if (loading) return (
    <div className="flex flex-col items-center justify-center w-full h-64 gap-4">
      <div className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading notes...</p>
    </div>
  )
  if (error) return <p className="text-red-500 text-center mt-8">{error}</p>

  return (
    <div className="w-full px-6 pb-6 page-enter">
      <Toaster position="bottom-right" reverseOrder />
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3 opacity-50">
          <span className="text-5xl">📭</span>
          <p className="text-lg font-medium" style={{ color: "var(--text-secondary)" }}>No notes found</p>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>{searchQuery ? "Try a different search" : "Add your first note!"}</p>
        </div>
      ) : (
        <div className={`grid ${gridCols} gap-4 mt-2`}>
          {filtered.map((item) => {
            const color   = TYPE_COLOR[item.type] ?? "#e1434b"
            const icon    = TYPE_ICON[item.type]  ?? "📝"
            const dateStr = new Date(item.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })

            return (
              <div key={item.id} className="relative rounded-xl border overflow-hidden cursor-pointer flex flex-col transition-all duration-250 hover:-translate-y-1 min-h-[200px]"
                style={{ background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "var(--shadow)" }}
                onClick={() => router.push(`/note/${item.id}`)}>

                <div className="h-1.5 w-full flex-shrink-0" style={{ background: color }} />

                <div className="p-4 flex-1 flex flex-col">
                  <div className="flex items-center gap-2 mb-2">
                    <span>{icon}</span>
                    <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full text-white" style={{ background: color }}>{item.type}</span>
                    {item.shareEnabled && (
                      <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                        🔗 Shared
                      </span>
                    )}
                  </div>
                  <h2 className="text-base font-semibold mb-1 line-clamp-2" style={{ color: "var(--text-primary)" }}>{item.title}</h2>
                  <p className="text-sm line-clamp-3 mb-3" style={{ color: "var(--text-secondary)" }}>{item.body.replace(/<[^>]+>/g, "")}</p>

                  {item.mediaUrl && (
                    <div className="rounded-lg overflow-hidden mb-3 flex-shrink-0">
                      {item.type === "image" && <img src={item.mediaUrl} alt={item.title} className="w-full h-32 object-cover" />}
                      {item.type === "video" && (() => {
                        const e = getYouTubeEmbedUrl(item.mediaUrl!)
                        return e ? <iframe src={e} className="w-full aspect-video" allowFullScreen title={item.title} /> : <video src={item.mediaUrl} controls className="w-full h-32" />
                      })()}
                      {item.type === "audio" && <audio src={item.mediaUrl} controls className="w-full h-10" />}
                    </div>
                  )}

                  {item.tags && item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-auto">
                      {item.tags.slice(0, 4).map((t) => <span key={t.id} className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>#{t.tagName}</span>)}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-4 py-2 border-t flex-shrink-0" style={{ borderColor: "var(--border)" }}
                     onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{dateStr}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={(e) => { e.stopPropagation(); setShareId(shareId === item.id ? null : item.id) }}
                      title="Share options" className="text-sm opacity-60 hover:opacity-100 transition-opacity">🔗</button>
                    <button onClick={(e) => { e.stopPropagation(); setDelId(delId === item.id ? null : item.id) }}
                      title="Delete" className="text-sm opacity-50 hover:opacity-100 hover:text-red-500 transition-all">🗑</button>
                  </div>
                </div>

                {/* Share modal */}
                {shareId === item.id && (
                  <div className="absolute inset-0 rounded-xl flex flex-col justify-end z-10" style={{ background: "rgba(0,0,0,0.65)" }}
                       onClick={(e) => e.stopPropagation()}>
                    <div className="m-3 rounded-xl p-3" style={{ background: "var(--bg-card)" }}>
                      <p className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>Share this note</p>
                      
                      <button onClick={() => sharePublic(item.id)} className="w-full py-1.5 text-xs text-white rounded-lg mb-2 font-medium hover:opacity-90 transition-opacity" style={{ background: "#6366f1" }}>
                        🌍 {item.shareEnabled ? "Copy Public Link (1 Day Expiry)" : "Enable & Copy Public Link (1 Day)"}
                      </button>

                      {friends.length > 0 && (
                        <div>
                          <p className="text-xs mb-1 font-medium" style={{ color: "var(--text-muted)" }}>Share with a friend:</p>
                          <div className="flex flex-col gap-1 max-h-24 overflow-y-auto mb-2">
                            {friends.map((f) => (
                              <button key={f.id} onClick={() => shareWithFriend(item.id, f.id)}
                                className="flex items-center gap-2 p-1.5 rounded-lg text-xs text-left hover:opacity-80 transition-opacity"
                                style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                                <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: "var(--accent)" }}>
                                  {(f.name ?? f.email ?? "F").charAt(0).toUpperCase()}
                                </div>
                                {f.name ?? f.email}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <button onClick={() => setShareId(null)} className="w-full py-1 text-xs rounded-lg font-medium" style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>Cancel</button>
                    </div>
                  </div>
                )}

                {/* Delete confirm */}
                {delId === item.id && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl z-10"
                       style={{ background: "rgba(0,0,0,0.75)" }} onClick={(e) => e.stopPropagation()}>
                    <p className="text-white text-sm font-medium">Delete this note?</p>
                    <div className="flex gap-2">
                      <button className="px-4 py-1.5 bg-red-500 text-white text-sm rounded-lg hover:bg-red-600" onClick={() => del(item.id)}>Yes, delete</button>
                      <button className="px-4 py-1.5 bg-white text-gray-800 text-sm rounded-lg" onClick={() => setDelId(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
