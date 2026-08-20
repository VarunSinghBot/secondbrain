"use client"

import { useState, useEffect } from "react"
import { Sparkles, Send, RefreshCw, Loader2 } from "lucide-react"

import type { RagAskResponse, RagReindexResponse } from "@secondbrain/types"

export default function RagAskBox() {
  const [query, setQuery] = useState("")
  const [answer, setAnswer] = useState("")
  const [citations, setCitations] = useState<RagAskResponse["citations"]>([])
  const [loading, setLoading] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [error, setError] = useState("")

  // Auto-index any unindexed content by default when dashboard loads
  useEffect(() => {
    fetch("/api/rag/reindex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: false }),
    }).catch(() => {})
  }, [])

  const ask = async () => {
    const trimmed = query.trim()
    if (!trimmed) return

    setLoading(true)
    setError("")

    try {
      const response = await fetch("/api/rag/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, topK: 5 }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to ask RAG backend")
      }

      setAnswer(data.answer ?? "")
      setCitations(data.citations ?? [])
    } catch (err) {
      setAnswer("")
      setCitations([])
      setError(err instanceof Error ? err.message : "Failed to ask RAG backend")
    } finally {
      setLoading(false)
    }
  }

  const reindex = async (force: boolean) => {
    setReindexing(true)
    try {
      const response = await fetch("/api/rag/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to reindex")
      }
      setError("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reindex")
    } finally {
      setReindexing(false)
    }
  }

  return (
    <div className="rounded-2xl border p-4 mb-6" style={{ background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "var(--shadow)" }}>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Sparkles className="w-5 h-5" style={{ color: "var(--accent)" }} strokeWidth={2} />
            Ask your brain
          </h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Search across your notes, media, and uploaded files with Gemini + Qdrant.</p>
        </div>

        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") ask()
          }}
          placeholder="Where is my particular image stored?"
          aria-label="Ask a question about your notes"
          className="min-h-[96px] w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ background: "var(--input-bg)", borderColor: "var(--border)", color: "var(--text-primary)", "--tw-ring-color": "var(--accent)" } as React.CSSProperties}
        />
        <p className="-mt-2 text-xs" style={{ color: "var(--text-muted)" }}>Press ⌘/Ctrl + Enter to ask</p>

        <div className="flex items-center gap-3">
          <button
            onClick={ask}
            disabled={loading}
            className="rounded-full px-4 py-2 text-sm font-medium text-white disabled:opacity-60 flex items-center gap-1.5"
            style={{ background: "var(--accent)" }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {loading ? "Searching..." : "Ask"}
          </button>
          <button
            onClick={() => reindex(false)}
            disabled={reindexing}
            className="rounded-full border px-4 py-2 text-sm font-medium disabled:opacity-60 flex items-center gap-1.5"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            {reindexing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {reindexing ? "Reindexing..." : "Reindex old notes/files"}
          </button>
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>

        {answer && (
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "rgba(255,255,255,0.02)" }}>
            <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--text-primary)" }}>{answer}</p>
          </div>
        )}

        {citations.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>Sources</p>
            <div className="flex flex-col gap-2">
              {citations.map((citation, index) => {
                const displayTitle = citation.sourceTitle || citation.title || citation.contentId
                const displayModality = citation.modality || citation.sourceType || "text"
                const emojis: Record<string, string> = {
                  audio: "🎵",
                  video: "🎬",
                  image: "🖼️",
                  text: "📄",
                  article: "📄",
                  pdf: "📄"
                }
                const emoji = emojis[displayModality.toLowerCase()] || "📄"

                return (
                  <a
                    key={`${citation.contentId}-${citation.chunkIndex}-${index}`}
                    href={`/note/${citation.contentId}`}
                    className="rounded-lg border px-3 py-2 text-sm transition-opacity hover:opacity-80 flex items-center justify-between"
                    style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                  >
                    <div>
                      <strong style={{ color: "var(--text-primary)" }}>[{index + 1}]</strong> {displayTitle}
                    </div>
                    <span 
                      className="text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 border"
                      style={{ 
                        borderColor: "var(--border)", 
                        background: "rgba(255,255,255,0.05)",
                        color: "var(--text-secondary)"
                      }}
                    >
                      {emoji} {displayModality}
                    </span>
                  </a>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}