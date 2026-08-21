"use client"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import SideBar from "@/components/SideBar"
import type { ContentItem } from "@secondbrain/types"
import { getYouTubeEmbedUrl } from "@/lib/media"
import toast, { Toaster } from "react-hot-toast"
import {
  ArrowLeft, Share2, Copy, AlertCircle, Clock, Calendar,
  SlidersHorizontal, X,
} from "lucide-react"

const TYPE_COLOR: Record<string, string> = {
  article: "#6366f1", image: "#ec4899", audio: "#f59e0b", video: "#10b981",
}

interface Comment {
  id: string
  content: string
  createdAt: string
  author: { id: string; name: string | null; username: string | null }
}

interface Friend { id: string; name: string | null; email: string | null }

export default function NoteDetailClient({ note, userId }: { note: ContentItem & { createdAt: string }; userId: string }) {
  const router = useRouter()
  const color  = TYPE_COLOR[note.type] ?? "#e1434b"

  const [delWarn,       setDelWarn]       = useState(false)
  const [showShare,     setShowShare]     = useState(false)
  const [friends,       setFriends]       = useState<Friend[]>([])
  const [shareEnabled,  setShareEnabled]  = useState(note.shareEnabled ?? false)
  const [shareLink,     setShareLink]     = useState<string | null>(null)
  const [shareExpiresAt,setShareExpiresAt]= useState<string | Date | null>(note.shareExpiresAt ?? null)
  const [isExpired,     setIsExpired]     = useState(false)
  const [duration,      setDuration]      = useState<"1h" | "1d" | "custom">("1d")
  const [customDays,    setCustomDays]    = useState(7)
  const [loadingShare,  setLoadingShare]  = useState(false)

  const [comments,   setComments]   = useState<Comment[]>([])
  const [newComment, setNewComment] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch(`/api/notes/${note.id}/comments`).then((r) => r.json()).then((d) => Array.isArray(d) && setComments(d)).catch(() => {})
  }, [note.id])

  useEffect(() => {
    if (showShare) {
      fetch("/api/friends").then((r) => r.json()).then((d) => Array.isArray(d) && setFriends(d)).catch(() => {})
      fetch(`/api/content/${note.id}/share`).then((r) => r.json()).then((d) => {
        if (d && !d.error) {
          setShareEnabled(d.shareEnabled)
          setShareLink(d.shareLink)
          setShareExpiresAt(d.shareExpiresAt)
          setIsExpired(d.isExpired)
        }
      }).catch(() => {})
    }
  }, [showShare, note.id])

  const handleDelete = async () => {
    await fetch(`/api/content/${note.id}`, { method: "DELETE" })
    router.push("/main")
  }

  const toggleSharePublic = async (enable: boolean) => {
    setLoadingShare(true)
    try {
      if (enable) {
        const body: { duration: string; days?: number } = { duration }
        if (duration === "custom") body.days = customDays
        const res = await fetch(`/api/content/${note.id}/share`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (res.ok) {
          setShareEnabled(true)
          setShareLink(data.shareLink)
          setShareExpiresAt(data.shareExpiresAt)
          setIsExpired(false)
          toast.success("Public link enabled!")
        } else {
          toast.error(data.error ?? "Failed to enable sharing")
        }
      } else {
        const res = await fetch(`/api/content/${note.id}/share`, { method: "DELETE" })
        if (res.ok) {
          setShareEnabled(false)
          setShareLink(null)
          setShareExpiresAt(null)
          setIsExpired(false)
          toast.success("Public link disabled!")
        }
      }
    } finally {
      setLoadingShare(false)
    }
  }

  const copyShareLink = async () => {
    if (!shareLink) return
    await navigator.clipboard.writeText(shareLink)
    toast.success("Share link copied to clipboard!")
  }

  const shareWithFriend = async (friendId: string) => {
    const res = await fetch(`/api/notes/${note.id}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "friend", friendId }) })
    if (res.ok) { toast.success("Note shared with friend!"); setShowShare(false) }
    else { const d = await res.json(); toast.error(d.error ?? "Failed") }
  }

  const addComment = async () => {
    if (!newComment.trim()) return
    setSubmitting(true)
    const res  = await fetch(`/api/notes/${note.id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: newComment }) })
    const data = await res.json()
    if (res.ok) { setComments((p) => [...p, data]); setNewComment("") }
    setSubmitting(false)
  }

  const deleteComment = async (commentId: string) => {
    await fetch(`/api/notes/${note.id}/comments/${commentId}`, { method: "DELETE" })
    setComments((p) => p.filter((c) => c.id !== commentId))
  }

  return (
    <div className="h-dvh w-dvw flex overflow-hidden" style={{ background: "var(--bg-primary)" }}>
      <Toaster position="bottom-right" reverseOrder />
      <div className="hidden md:block md:w-[220px] flex-shrink-0 h-full"><SideBar /></div>
      <div className="flex-1 overflow-y-auto page-enter">

        {/* Top bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-8 py-3 border-b backdrop-blur-sm" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <button onClick={() => router.push("/main")} className="flex items-center gap-1.5 text-sm font-medium hover:opacity-70 transition-opacity" style={{ color: "var(--text-secondary)" }}>
            <ArrowLeft className="w-4 h-4" strokeWidth={2} /> Back
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowShare((p) => !p)} className="px-4 py-1.5 text-sm font-medium rounded-full border transition-all hover:shadow flex items-center gap-1.5" style={{ borderColor: "#6366f1", color: "#6366f1" }}>
              <Share2 className="w-3.5 h-3.5" /> Share
            </button>
            <button onClick={() => router.push(`/addItem?id=${note.id}`)} className="px-4 py-1.5 text-sm font-medium rounded-full border transition-all hover:shadow" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>Edit</button>
            <button onClick={() => setDelWarn(true)} className="px-4 py-1.5 text-sm font-medium text-white rounded-full transition-all hover:shadow" style={{ background: "#ef4444" }}>Delete</button>
          </div>
        </div>

        {/* Share panel */}
        {showShare && (
          <div className="mx-8 mt-4 rounded-xl border p-5 transition-all" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-4 border-b pb-3" style={{ borderColor: "var(--border)" }}>
              <div>
                <h3 className="font-semibold text-base" style={{ color: "var(--text-primary)" }}>Public Link Share</h3>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>Anyone with the link can view this single note</p>
              </div>

              {/* Toggle switch */}
              <button
                onClick={() => toggleSharePublic(!shareEnabled)}
                disabled={loadingShare}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${shareEnabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${shareEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {shareEnabled && shareLink ? (
              <div className="flex flex-col gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareLink}
                    className="flex-1 text-xs px-3 py-2 rounded-lg border focus:outline-none"
                    style={{ background: "var(--input-bg)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                  />
                  <button
                    onClick={copyShareLink}
                    className="px-3 py-2 text-xs font-medium text-white rounded-lg transition-opacity hover:opacity-90 flex-shrink-0 flex items-center gap-1.5"
                    style={{ background: "#6366f1" }}
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy Link
                  </button>
                </div>

                <div className="flex items-center justify-between text-xs px-1">
                  <span className="flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                    {isExpired
                      ? <><AlertCircle className="w-3.5 h-3.5 text-red-500" /> Link Expired</>
                      : <><Clock className="w-3.5 h-3.5" /> Expires:</>} {shareExpiresAt ? new Date(shareExpiresAt).toLocaleString("en-GB") : "No expiry"}
                  </span>
                </div>
              </div>
            ) : null}

            {/* Duration Selector when turning on or updating */}
            <div className="mb-4 bg-opacity-50 p-3 rounded-lg border" style={{ borderColor: "var(--border)", background: "var(--input-bg)" }}>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
                {shareEnabled ? "Update Link Expiry Duration:" : "Set Link Expiry Duration:"}
              </p>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <button
                  onClick={() => setDuration("1h")}
                  className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all flex items-center gap-1.5 ${duration === "1h" ? "bg-indigo-600 text-white border-indigo-600" : ""}`}
                  style={duration !== "1h" ? { borderColor: "var(--border)", color: "var(--text-primary)" } : {}}
                >
                  <Clock className="w-3.5 h-3.5" /> 1 Hour
                </button>
                <button
                  onClick={() => setDuration("1d")}
                  className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all flex items-center gap-1.5 ${duration === "1d" ? "bg-indigo-600 text-white border-indigo-600" : ""}`}
                  style={duration !== "1d" ? { borderColor: "var(--border)", color: "var(--text-primary)" } : {}}
                >
                  <Calendar className="w-3.5 h-3.5" /> 1 Day
                </button>
                <button
                  onClick={() => setDuration("custom")}
                  className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-all flex items-center gap-1.5 ${duration === "custom" ? "bg-indigo-600 text-white border-indigo-600" : ""}`}
                  style={duration !== "custom" ? { borderColor: "var(--border)", color: "var(--text-primary)" } : {}}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" /> Custom Days
                </button>
              </div>

              {duration === "custom" && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Duration (Days):</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={customDays}
                    onChange={(e) => setCustomDays(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-20 text-xs px-2 py-1 rounded border focus:outline-none"
                    style={{ background: "var(--bg-primary)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                  />
                </div>
              )}

              <button
                onClick={() => toggleSharePublic(true)}
                disabled={loadingShare}
                className="mt-3 text-xs px-3 py-1.5 rounded-lg text-white font-medium hover:opacity-90"
                style={{ background: "var(--accent)" }}
              >
                {shareEnabled ? "Update Expiry" : "Enable Public Link"}
              </button>
            </div>

            {/* In-app Friend Sharing Section */}
            {friends.length > 0 && (
              <div className="pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                <p className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>Share directly with a friend (in-app):</p>
                <div className="flex flex-wrap gap-2">
                  {friends.map((f) => (
                    <button key={f.id} onClick={() => shareWithFriend(f.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-all hover:opacity-80"
                      style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                      <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: "var(--accent)" }}>
                        {(f.name ?? f.email ?? "F").charAt(0).toUpperCase()}
                      </div>
                      {f.name ?? f.email}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Article */}
        <article className="max-w-3xl mx-auto px-8 py-12">
          <div className="flex items-center gap-3 mb-6">
            <span className="text-sm font-semibold uppercase tracking-wider px-3 py-1 rounded-full text-white" style={{ background: color }}>{note.type}</span>
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>{new Date(note.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
          </div>
          <h1 className="text-4xl font-bold mb-6 leading-tight" style={{ color: "var(--text-primary)" }}>{note.title}</h1>
          {note.tags && note.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-8">
              {note.tags.map((t) => <span key={t.id} className="text-sm px-3 py-1 rounded-full border" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>#{t.tagName}</span>)}
            </div>
          )}
          <div className="h-px mb-8" style={{ background: "var(--border)" }} />
          <div className="prose max-w-none text-lg leading-8 [&_img]:max-w-full [&_img]:h-auto [&_video]:max-w-full [&_iframe]:max-w-full [&_audio]:w-full"
               style={{ color: "var(--text-primary)" }} dangerouslySetInnerHTML={{ __html: note.body }} />
          {note.mediaUrl && (
            <div className="mt-10 rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)" }}>
              {note.type === "image" && <img src={note.mediaUrl} alt={note.title} className="w-full object-cover" />}
              {note.type === "video" && (() => {
                const e = getYouTubeEmbedUrl(note.mediaUrl!)
                return e ? <iframe src={e} className="w-full aspect-video" allowFullScreen title={note.title} /> : <video src={note.mediaUrl} controls className="w-full" />
              })()}
              {note.type === "audio" && <audio src={note.mediaUrl} controls className="w-full p-4" />}
              {note.type === "article" && <a href={note.mediaUrl} target="_blank" rel="noopener noreferrer" className="block p-4 text-blue-500 underline">{note.mediaUrl}</a>}
            </div>
          )}
        </article>

        {/* Comments */}
        <section className="max-w-3xl mx-auto px-8 pb-16">
          <div className="h-px mb-8" style={{ background: "var(--border)" }} />
          <h2 className="text-xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>Comments ({comments.length})</h2>

          {/* Add comment */}
          <div className="flex gap-3 mb-6">
            <textarea
              placeholder="Add a comment..."
              className="flex-1 px-4 py-3 rounded-xl border text-sm resize-none focus:outline-none"
              style={{ background: "var(--input-bg)", borderColor: "var(--border)", color: "var(--text-primary)", minHeight: "80px" }}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
            />
            <button onClick={addComment} disabled={submitting || !newComment.trim()}
              className="px-4 py-2 text-sm text-white rounded-xl font-medium disabled:opacity-50 self-end transition-all hover:shadow"
              style={{ background: "var(--accent)" }}>
              {submitting ? "..." : "Post"}
            </button>
          </div>

          {/* Comment list */}
          {comments.length === 0 ? (
            <p className="text-sm text-center py-6 opacity-40" style={{ color: "var(--text-muted)" }}>No comments yet. Be the first!</p>
          ) : (
            <div className="flex flex-col gap-4">
              {comments.map((c) => (
                <div key={c.id} className="rounded-xl p-4 border" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: "var(--accent)" }}>
                        {(c.author.name ?? c.author.username ?? "U").charAt(0).toUpperCase()}
                      </div>
                      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{c.author.name ?? c.author.username ?? "User"}</p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{new Date(c.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
                    </div>
                    {c.author.id === userId && (
                      <button onClick={() => deleteComment(c.id)} className="hover:text-red-500 transition-colors" style={{ color: "var(--text-muted)" }} aria-label="Delete comment">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{c.content}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Delete modal */}
        {delWarn && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="rounded-xl p-6 max-w-sm w-full shadow-2xl" style={{ background: "var(--bg-card)" }}>
              <h2 className="text-lg font-bold mb-2" style={{ color: "var(--text-primary)" }}>Delete this note?</h2>
              <p className="text-sm mb-5" style={{ color: "var(--text-secondary)" }}>This cannot be undone.</p>
              <div className="flex gap-3">
                <button onClick={handleDelete} className="flex-1 py-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600">Delete</button>
                <button onClick={() => setDelWarn(false)} className="flex-1 py-2 rounded-lg font-medium border" style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}