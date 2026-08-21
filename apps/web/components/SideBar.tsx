"use client"
import { usePathname, useRouter } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import { useEffect, useState } from "react"
import toast, { Toaster } from "react-hot-toast"
import {
  Brain, Home, Share2, Link2, Settings, ChevronDown, ChevronUp,
  FileText, Image as ImageIcon, Music, Video, MessageCircle, LogOut,
  Menu, X, UserPlus, Check as CheckIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

interface Friend { id: string; name: string | null; email: string | null; username: string | null }
interface FriendRequest { id: string; sender: { id: string; name: string | null; email: string | null } }

export default function SideBar({ onFilter }: { onFilter?: (t: string | null) => void }) {
  const router           = useRouter()
  const pathname         = usePathname()
  const { data: session } = useSession()
  const [friends,       setFriends]       = useState<Friend[]>([])
  const [requests,      setRequests]      = useState<FriendRequest[]>([])
  const [showAddFriend, setShowAddFriend] = useState(false)
  const [friendEmail,   setFriendEmail]   = useState("")
  const [addLoading,    setAddLoading]    = useState(false)
  const [showFilters,   setShowFilters]   = useState(false)
  const [mobileOpen,    setMobileOpen]    = useState(false)

  useEffect(() => {
    fetch("/api/friends").then((r) => r.json()).then((d) => Array.isArray(d) && setFriends(d)).catch(() => {})
    fetch("/api/friends/requests").then((r) => r.json()).then((d) => Array.isArray(d) && setRequests(d)).catch(() => {})
  }, [])

  const logout = async () => {
    await signOut({ redirect: false })
    toast.success("Logged out!")
    router.push("/login")
  }

  const sendRequest = async () => {
    if (!friendEmail.trim()) return
    setAddLoading(true)
    try {
      const res  = await fetch("/api/friends/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: friendEmail }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success("Friend request sent!")
      setFriendEmail(""); setShowAddFriend(false)
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed") }
    setAddLoading(false)
  }

  const handleRequest = async (id: string, action: "accept" | "reject") => {
    await fetch(`/api/friends/requests/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) })
    setRequests((p) => p.filter((r) => r.id !== id))
    if (action === "accept") {
      const req = requests.find((r) => r.id === id)
      if (req) setFriends((p) => [...p, { id: req.sender.id, name: req.sender.name, email: req.sender.email, username: null }])
      toast.success("Friend added!")
    }
  }

  const navItem = (Icon: LucideIcon, label: string, href: string, active: boolean) => (
    <button key={label} onClick={() => { router.push(href); setMobileOpen(false) }}
      className="w-full h-[40px] flex items-center gap-2.5 px-3 rounded-lg text-sm font-medium transition-all duration-200"
      style={active
        ? {
            background: "color-mix(in srgb, var(--accent) 12%, transparent)",
            color: "var(--accent)",
            border: "1px solid transparent",
            boxShadow: "inset 3px 0 0 0 var(--accent)",
          }
        : {
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
            boxShadow: "inset 3px 0 0 0 transparent",
          }}>
      <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={2} />
      {label}
    </button>
  )

  const filters: { label: string; type: string; icon: LucideIcon }[] = [
    { label: "Article", type: "article", icon: FileText },
    { label: "Image",   type: "image",   icon: ImageIcon },
    { label: "Audio",   type: "audio",   icon: Music },
    { label: "Video",   type: "video",   icon: Video },
  ]

  return (
    <>
      <Toaster position="bottom-right" reverseOrder />

      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen((p) => !p)}
        aria-label={mobileOpen ? "Close menu" : "Open menu"}
        className="md:hidden fixed top-3 left-3 z-50 h-10 w-10 rounded-lg flex items-center justify-center shadow-md"
        style={{ background: "var(--accent)" }}>
        {mobileOpen ? <X className="w-5 h-5 text-white" /> : <Menu className="w-5 h-5 text-white" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-30 bg-black/50" onClick={() => setMobileOpen(false)} />
      )}

      <div
        className={`fixed md:static inset-y-0 left-0 z-40 w-72 md:w-full h-full flex flex-col overflow-y-auto pt-4 pb-4 transition-transform duration-300 md:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
        style={{ background: "var(--bg-sidebar)", borderRight: "1px solid var(--border)" }}>
        {/* Logo */}
        <div className="flex items-center px-4 mb-4 flex-shrink-0 md:pl-4 pl-14">
          <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white mr-2 flex-shrink-0" style={{ background: "var(--accent)" }}>
            <Brain className="w-5 h-5" strokeWidth={2.25} />
          </div>
          <h1 className="text-lg font-bold" style={{ color: "var(--accent)" }}>Second Brain</h1>
        </div>

        {/* Nav */}
        <div className="flex flex-col gap-1.5 px-3 mb-3">
          {navItem(Home,   "Dashboard",       "/main",     pathname === "/main")}
          {navItem(Share2, "Shared With Me",  "/shared",   pathname === "/shared")}
          {navItem(Link2,  "My Shared Links", "/sharing",  pathname === "/sharing")}
          {navItem(Settings, "Settings",      "/settings", pathname === "/settings")}
        </div>

        <div className="mx-3 h-px mb-3" style={{ background: "var(--border)" }} />

        {/* Filters toggle */}
        <div className="px-3 mb-2">
          <button onClick={() => setShowFilters((p) => !p)} className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider py-1"
            style={{ color: "var(--text-muted)" }}>
            <span>Filter by type</span>
            {showFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showFilters && (
            <div className="flex flex-col gap-1.5 mt-2">
              <button onClick={() => onFilter?.(null)} className="w-full h-8 rounded-lg text-xs font-medium text-white" style={{ background: "var(--accent)" }}>Reset</button>
              {filters.map((f) => (
                <button key={f.type} onClick={() => onFilter?.(f.type)} className="w-full h-9 rounded-lg text-sm text-left px-3 flex items-center gap-2.5 transition-all hover:opacity-80"
                  style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                  <f.icon className="w-4 h-4 flex-shrink-0" strokeWidth={2} />
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mx-3 h-px mb-3" style={{ background: "var(--border)" }} />

        {/* Friend Requests */}
        {requests.length > 0 && (
          <div className="px-3 mb-3">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
              Friend Requests <span className="ml-1 px-1.5 py-0.5 rounded-full text-white text-xs" style={{ background: "var(--accent)" }}>{requests.length}</span>
            </p>
            {requests.map((req) => (
              <div key={req.id} className="rounded-lg p-2 mb-1.5" style={{ background: "var(--input-bg)" }}>
                <p className="text-xs font-medium mb-1" style={{ color: "var(--text-primary)" }}>{req.sender.name ?? req.sender.email}</p>
                <div className="flex gap-1.5">
                  <button onClick={() => handleRequest(req.id, "accept")} className="flex-1 py-0.5 text-xs text-white rounded font-medium flex items-center justify-center gap-1" style={{ background: "#22c55e" }}>
                    <CheckIcon className="w-3 h-3" /> Accept
                  </button>
                  <button onClick={() => handleRequest(req.id, "reject")} className="flex-1 py-0.5 text-xs text-white rounded font-medium flex items-center justify-center gap-1" style={{ background: "#ef4444" }}>
                    <X className="w-3 h-3" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Friends */}
        <div className="px-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Friends ({friends.length})</p>
            <button onClick={() => setShowAddFriend((p) => !p)} className="text-xs pl-1.5 pr-2 py-0.5 rounded text-white font-medium flex items-center gap-1" style={{ background: "var(--accent)" }}>
              <UserPlus className="w-3 h-3" /> Add
            </button>
          </div>

          {showAddFriend && (
            <div className="mb-2 flex gap-1.5">
              <input type="email" placeholder="Friend's email" className="flex-1 h-8 px-2 rounded text-xs border focus:outline-none"
                style={{ background: "var(--input-bg)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                value={friendEmail} onChange={(e) => setFriendEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendRequest()} />
              <button onClick={sendRequest} disabled={addLoading} className="px-2 h-8 text-xs text-white rounded disabled:opacity-50" style={{ background: "var(--accent)" }}>
                {addLoading ? "..." : "Send"}
              </button>
            </div>
          )}

          <div className="flex flex-col gap-1">
            {friends.length === 0 ? (
              <p className="text-xs py-2 text-center" style={{ color: "var(--text-muted)" }}>No friends yet</p>
            ) : friends.map((f) => (
              <button key={f.id} onClick={() => { router.push(`/dm/${f.id}`); setMobileOpen(false) }}
                className="flex items-center gap-2 p-1.5 rounded-lg transition-all hover:opacity-80"
                style={{ border: "1px solid var(--border)" }}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: "var(--accent)" }}>
                  {(f.name ?? f.email ?? "F").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 text-left">
                  <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{f.name ?? f.username ?? "Friend"}</p>
                  <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{f.email}</p>
                </div>
                <MessageCircle className="ml-auto w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
              </button>
            ))}
          </div>
        </div>

        <div className="mx-3 h-px mb-3" style={{ background: "var(--border)" }} />

        {/* Chat + Logout */}
        <div className="flex flex-col gap-2 px-3 mt-auto">
          <button onClick={logout} className="w-full h-[40px] text-sm font-medium text-white rounded-lg transition-all hover:opacity-90 flex items-center justify-center gap-2"
            style={{ background: "var(--accent)" }}>
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </div>
    </>
  )
}