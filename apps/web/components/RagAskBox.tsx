"use client"

import { useState, useEffect } from "react"

import type { RagAskResponse, RagReindexResponse } from "@secondbrain/types"

export default function RagAskBox() {
  const [query, setQuery] = useState("")
  const [answer, setAnswer] = useState("")
  const [citations, setCitations] = useState<RagAskResponse["citations"]>([])
  const [loading, setLoading] = useState(false)
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

  return (
    <div className="rounded-2xl border p-4 mb-6" style={{ background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "var(--shadow)" }}>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>Ask your brain</h2>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Search across your notes, media, and uploaded files with Groq + Qdrant.</p>
        </div>

        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Where is my particular image stored?"
          className="min-h-[96px] w-full rounded-xl border px-3 py-2 text-sm focus:outline-none"
          style={{ background: "var(--input-bg)", borderColor: "var(--border)", color: "var(--text-primary)" }}
        />

        <div className="flex items-center gap-3">
          <button
            onClick={ask}
            disabled={loading}
            className="rounded-full px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: "var(--accent)" }}
          >
            {loading ? "Searching..." : "Ask"}
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