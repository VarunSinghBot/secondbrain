"use client"
import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useSelector } from "react-redux"
import type { RootState } from "@/store/store"
import SideBar from "@/components/SideBar"
import type { ContentItem } from "@secondbrain/types"

const TYPE_ICON:  Record<string, string> = { article: "📄", image: "🖼", audio: "🎵", video: "🎬" }
const TYPE_COLOR: Record<string, string> = { article: "#6366f1", image: "#ec4899", audio: "#f59e0b", video: "#10b981" }
const TYPE_FILTERS = ["article", "image", "audio", "video"]

export default function SharedPage() {
  const router  = useRouter()
  const layout  = useSelector((s: RootState) => s.theme.layout)
  const [items,       setItems]       = useState<(ContentItem & { sharedBy: { name: string; email: string } })[]>([])
  const [loading,     setLoading]     = useState(true)
  const [filterType,  setFilterType]  = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const res = await fetch("/api/shared")
        if (res.ok) setItems(await res.json())
      } finally { setLoading(false) }
    })()
  }, [])

  const filtered = useMemo(() => {
    let r = items
    if (filterType) r = r.filter((i) => i.type === filterType)
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      r = r.filter((i) => i.title.toLowerCase().includes(q) || i.body.toLowerCase().includes(q) || i.tags?.some((t) => t.tagName.toLowerCase().includes(q)))
    }
    return r
  }, [items, filterType, searchQuery])

  const gridCols = layout === "compact" ? "grid-cols-4" : layout === "spacious" ? "grid-cols-2" : "grid-cols-3"

  return (
    <div className="h-dvh w-dvw flex overflow-hidden transition-colors duration-300" style={{ background: "var(--bg-primary)" }}>
      <div className="w-[220px] flex-shrink-0 h-full"><SideBar /></div>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>Shared With Me</h1>
          <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>Notes your friends have shared with you</p>
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-muted)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" placeholder="Search shared notes..." className="w-full h-9 rounded-full pl-9 pr-4 text-sm border focus:outline-none" style={{ background: "var(--input-bg)", borderColor: "var(--border)", color: "var(--text-primary)" }} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            {/* Type filters */}
            <div className="flex items-center gap-2">
              <button onClick={() => setFilterType(null)} className="h-8 px-3 rounded-full text-xs font-medium transition-all" style={{ background: !filterType ? "var(--accent)" : "var(--input-bg)", color: !filterType ? "#fff" : "var(--text-secondary)" }}>All</button>
              {TYPE_FILTERS.map((t) => (
                <button key={t} onClick={() => setFilterType(t === filterType ? null : t)} className="h-8 px-3 rounded-full text-xs font-medium capitalize transition-all" style={{ background: filterType === t ? TYPE_COLOR[t] : "var(--input-bg)", color: filterType === t ? "#fff" : "var(--text-secondary)" }}>
                  {TYPE_ICON[t]} {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64 gap-3">
              <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading shared notes...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 opacity-50">
              <span className="text-5xl">🤝</span>
              <p className="text-lg font-medium" style={{ color: "var(--text-secondary)" }}>{searchQuery ? "No results found" : "Nothing shared with you yet"}</p>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>When friends share notes with you, they'll appear here</p>
            </div>
          ) : (
            <div className={`grid ${gridCols} gap-4`}>
              {filtered.map((item) => {
                const color = TYPE_COLOR[item.type] ?? "#e1434b"
                const icon  = TYPE_ICON[item.type]  ?? "📝"
                return (
                  <div key={item.id} className="rounded-xl border overflow-hidden cursor-pointer flex flex-col transition-all duration-200 hover:-translate-y-1 min-h-[200px]"
                       style={{ background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "var(--shadow)" }}
                       onClick={() => router.push(`/note/${item.id}`)}>
                    <div className="h-1.5 w-full flex-shrink-0" style={{ background: color }} />
                    <div className="p-4 flex-1 flex flex-col">
                      <div className="flex items-center gap-2 mb-2">
                        <span>{icon}</span>
                        <span className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full text-white" style={{ background: color }}>{item.type}</span>
                      </div>
                      <h2 className="text-base font-semibold mb-1 line-clamp-2" style={{ color: "var(--text-primary)" }}>{item.title}</h2>
                      <p className="text-sm line-clamp-3 mb-3" style={{ color: "var(--text-secondary)" }}>{item.body.replace(/<[^>]+>/g, "")}</p>
                      {item.tags && item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-auto">
                          {item.tags.slice(0, 3).map((t) => <span key={t.id} className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>#{t.tagName}</span>)}
                        </div>
                      )}
                    </div>
                    <div className="px-4 py-2 border-t flex items-center justify-between flex-shrink-0" style={{ borderColor: "var(--border)" }}>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{new Date(item.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                      <span className="text-xs font-medium" style={{ color: "var(--accent)" }}>by {item.sharedBy?.name ?? "Friend"}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
