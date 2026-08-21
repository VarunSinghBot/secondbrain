"use client"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import toast, { Toaster } from "react-hot-toast"
import { Search, Plus, Share2, ChevronDown, Globe, Users, Copy } from "lucide-react"

interface TopBarProps {
  onSearch?: (q: string) => void
  searchValue?: string
}

export default function TopBar({ onSearch, searchValue = "" }: TopBarProps) {
  const router            = useRouter()
  const { data: session } = useSession()
  const username          = session?.user?.name ?? session?.user?.email?.split("@")[0] ?? "User"
  const [open,      setOpen]      = useState(false)
  const [shareMode, setShareMode] = useState<"public" | "friends">("public")
  const [sharable,  setSharable]  = useState(false)
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [friends,   setFriends]   = useState<{ id: string; name: string | null; email: string | null }[]>([])
  const [loading,   setLoading]   = useState(false)
  const [err,       setErr]       = useState<string | null>(null)
  const [search,    setSearch]    = useState(searchValue)

  useEffect(() => { setSearch(searchValue) }, [searchValue])

  useEffect(() => {
    if (open) {
      fetch("/api/friends").then((r) => r.json()).then((data) => {
        if (Array.isArray(data)) setFriends(data)
      }).catch(() => {})
    }
  }, [open])

  const togglePublicShare = async () => {
    setLoading(true); setErr(null)
    try {
      if (!sharable) {
        const res = await fetch("/api/links", { method: "POST" })
        const d   = await res.json()
        if (!res.ok) throw new Error(d.error)
        setShareLink(d.shareLink); setSharable(true)
      } else {
        if (shareLink) await fetch(`/api/links/${shareLink.split("/").pop()}`, { method: "DELETE" })
        setShareLink(null); setSharable(false)
      }
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error") }
    setLoading(false)
  }

  const shareWithFriend = async (friendId: string) => {
    setLoading(true); setErr(null)
    try {
      // Share all content — create a link tied to the user
      const res = await fetch("/api/links", { method: "POST" })
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error)
      toast.success("All notes shared with friend!")
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "Error") }
    setLoading(false)
  }

  const copy = async (link: string) => {
    await navigator.clipboard.writeText(link)
    toast.success("Copied!", { style: { border: "1px solid #fff", padding: "16px", color: "#000" }, iconTheme: { primary: "#000", secondary: "#FFFAEE" } })
  }

  return (
    <div className="h-full w-full flex justify-between items-center gap-2 border-b pl-16 pr-4 md:px-4 transition-colors duration-300" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
      <Toaster position="bottom-right" reverseOrder />
      {/* Avatar */}
      <div className="hidden sm:flex items-center gap-3 min-w-0 flex-shrink-0">
        <div className="h-9 w-9 rounded-full flex items-center justify-center font-bold text-white text-sm flex-shrink-0" style={{ background: "var(--accent)" }}>
          {username.charAt(0).toUpperCase()}
        </div>
        <div className="hidden lg:block min-w-0">
          <p className="text-sm font-semibold leading-none truncate" style={{ color: "var(--text-primary)" }}>{username}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Welcome back!</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex-1 min-w-0 max-w-md relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-muted)" }} strokeWidth={2} />
        <input type="text" placeholder="Search notes..." aria-label="Search notes by title or tag" className="w-full h-9 rounded-full pl-9 pr-4 text-sm border focus:outline-none focus:ring-2 transition-all duration-200"
          style={{ background: "var(--input-bg)", borderColor: "var(--border)", color: "var(--text-primary)", "--tw-ring-color": "var(--accent)" } as React.CSSProperties}
          value={search} onChange={(e) => { setSearch(e.target.value); onSearch?.(e.target.value) }} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button className="h-9 px-3 sm:px-4 text-sm font-medium rounded-full border transition-all duration-200 hover:shadow whitespace-nowrap flex items-center gap-1.5"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
          onClick={() => router.push("/addItem")}>
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          <span className="hidden sm:inline">New Note</span>
        </button>

        {/* Share All Notes */}
        <div className="relative">
          <button className="h-9 px-3 sm:px-4 text-sm font-medium text-white rounded-full transition-all duration-200 hover:shadow-lg whitespace-nowrap flex items-center gap-1.5"
            style={{ background: "var(--accent)" }}
            onClick={() => setOpen((p) => !p)}
            aria-expanded={open}
            aria-label="Share all notes">
            <Share2 className="w-4 h-4" strokeWidth={2} />
            <span className="hidden sm:inline">Share All Notes</span>
            <ChevronDown className="hidden sm:inline w-3.5 h-3.5" strokeWidth={2.5} />
          </button>

          {open && (
            <div className="absolute right-0 mt-2 w-[88vw] max-w-96 rounded-xl border shadow-xl z-50 p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
              <p className="font-semibold text-sm mb-3" style={{ color: "var(--text-primary)" }}>Share All Notes</p>

              {/* Mode tabs */}
              <div className="flex rounded-lg overflow-hidden border mb-4" style={{ borderColor: "var(--border)" }}>
                {(["public", "friends"] as const).map((mode) => (
                  <button key={mode} onClick={() => setShareMode(mode)}
                    className="flex-1 py-1.5 text-xs font-medium capitalize transition-all flex items-center justify-center gap-1.5"
                    style={{ background: shareMode === mode ? "var(--accent)" : "var(--input-bg)", color: shareMode === mode ? "#fff" : "var(--text-secondary)" }}>
                    {mode === "public" ? <Globe className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
                    {mode === "public" ? "Public Link" : "With Friends"}
                  </button>
                ))}
              </div>

              {shareMode === "public" && (
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Public sharing:</span>
                    <button
                      className={`relative w-11 h-6 flex items-center rounded-full border-2 border-transparent transition-colors duration-200 ${sharable ? "bg-green-500" : "bg-gray-300"}`}
                      onClick={togglePublicShare} disabled={loading}>
                      <span className={`w-[18px] h-[18px] rounded-full bg-white shadow transition-transform duration-200 ${sharable ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>{sharable ? "On" : "Off"}</span>
                  </div>
                  {loading && <p className="text-xs" style={{ color: "var(--text-muted)" }}>Updating...</p>}
                  {err     && <p className="text-xs text-red-500">{err}</p>}
                  {sharable && shareLink && (
                    <div className="mt-2">
                      <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Anyone with this link can view your notes:</p>
                      <div className="flex gap-2">
                        <input readOnly value={shareLink} className="flex-1 p-1.5 text-xs rounded border" style={{ background: "var(--input-bg)", borderColor: "var(--border)", color: "var(--text-primary)" }} onFocus={(e) => e.target.select()} />
                        <button className="px-2.5 py-1.5 text-xs text-white rounded font-medium flex items-center gap-1 flex-shrink-0" style={{ background: "var(--accent)" }} onClick={() => copy(shareLink)}>
                          <Copy className="w-3 h-3" /> Copy
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {shareMode === "friends" && (
                <div>
                  {friends.length === 0 ? (
                    <p className="text-sm text-center py-4" style={{ color: "var(--text-muted)" }}>No friends yet. Add friends from the sidebar!</p>
                  ) : (
                    <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                      {friends.map((f) => (
                        <div key={f.id} className="flex items-center justify-between p-2 rounded-lg" style={{ background: "var(--input-bg)" }}>
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: "var(--accent)" }}>
                              {(f.name ?? f.email ?? "F").charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{f.name ?? "Friend"}</p>
                              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{f.email}</p>
                            </div>
                          </div>
                          <button onClick={() => shareWithFriend(f.id)} className="px-3 py-1 text-xs text-white rounded-full font-medium transition-all hover:opacity-90" style={{ background: "var(--accent)" }}>
                            Share
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}