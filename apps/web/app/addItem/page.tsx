"use client"
import { useState, useRef, useEffect, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import SideBar from "@/components/SideBar"
import EditorBody from "@/components/editor/EditorBody"
import EditorToolbar from "@/components/editor/EditorToolbar"
import MediaToolbar from "@/components/editor/MediaToolbar"
import TagInput from "@/components/editor/TagInput"
import toast, { Toaster } from "react-hot-toast"
import type { ContentType, MediaTool } from "@/lib/editor"
import { buildMediaHtml } from "@/lib/editor"

export default function AddItemPage() {
  const router     = useRouter()
  const params     = useSearchParams()
  const editId     = params.get("id")
  const { status } = useSession()

  const [title,     setTitle]     = useState("")
  const [type,      setType]      = useState<ContentType>("article")
  const [tags,      setTags]      = useState<string[]>([])
  const [tagInput,  setTagInput]  = useState("")
  const [suggestedTags, setSuggestedTags] = useState<string[]>([])
  const [suggestingTags, setSuggestingTags] = useState(false)
  const [error,     setError]     = useState("")
  const [saving,    setSaving]    = useState(false)
  const [wordCount, setWordCount] = useState(0)
  const [activeMediaTool, setActiveMediaTool] = useState<MediaTool | null>(null)
  const [mediaInput, setMediaInput] = useState("")

  const bodyRef = useRef<HTMLDivElement>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const selectionRef = useRef<Range | null>(null)

  useEffect(() => {
    if (!editId) return
    ;(async () => {
      const res  = await fetch(`/api/content/${editId}`)
      if (!res.ok) return
      const note = await res.json()
      setTitle(note.title)
      setType(note.type)
      setTags(note.tags?.map((t: { tagName: string }) => t.tagName) ?? [])
      if (bodyRef.current) bodyRef.current.innerHTML = note.body
      countWords()
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])

  const countWords = useCallback(() => {
    const text = bodyRef.current?.innerText ?? ""
    const words = text.trim().split(" ").filter((w) => w.length > 0)
    setWordCount(words.length)
  }, [])

  useEffect(() => {
    if (!activeMediaTool) return
    window.requestAnimationFrame(() => mediaInputRef.current?.focus())
  }, [activeMediaTool])

  const saveSelection = useCallback(() => {
    const selection = window.getSelection()
    if (selection?.rangeCount) {
      selectionRef.current = selection.getRangeAt(0).cloneRange()
    }
  }, [])

  const placeCursorAtEnd = useCallback(() => {
    const editor = bodyRef.current
    if (!editor) return

    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)

    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    selectionRef.current = range
  }, [])

  const insertHtmlAtCursor = useCallback((html: string) => {
    const editor = bodyRef.current
    if (!editor || !html) return

    editor.focus()
    const selection = window.getSelection()
    if (selection && selectionRef.current) {
      selection.removeAllRanges()
      selection.addRange(selectionRef.current)
    } else {
      placeCursorAtEnd()
    }

    document.execCommand("insertHTML", false, html)

    const updatedSelection = window.getSelection()
    if (updatedSelection?.rangeCount) {
      selectionRef.current = updatedSelection.getRangeAt(0).cloneRange()
    }

    countWords()
  }, [countWords, placeCursorAtEnd])

  // rag-backend/api/tags/suggest only generates real suggestions for
  // type === "image" (STRICT REQUIREMENT there) — callers below gate on
  // that before invoking this, so `type` is always "image" by the time
  // this actually runs, but it's still passed through rather than
  // hardcoded so the payload stays honest about what was asked.
  const fetchTagSuggestions = useCallback(async (imageUrl: string, suggestionType: ContentType) => {
    setSuggestingTags(true)
    try {
      const res = await fetch("/api/tags/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, title, body: bodyRef.current?.innerText ?? "", type: suggestionType }),
      })
      if (!res.ok) return
      const data = await res.json()
      setSuggestedTags(data.suggestions ?? [])
    } catch {
      // Suggestions are a nice-to-have — a failure here shouldn't interrupt writing.
    } finally {
      setSuggestingTags(false)
    }
  }, [title])

  const openMediaPopover = (tool: MediaTool) => {
    setActiveMediaTool((current) => (current === tool ? null : tool))
    setMediaInput("")
  }

  const confirmMediaInsert = () => {
    if (!activeMediaTool) return
    const html = buildMediaHtml(activeMediaTool, mediaInput)
    if (!html) return

    insertHtmlAtCursor(html)
    if (activeMediaTool === "image") {
      setType("image")
      fetchTagSuggestions(mediaInput, "image")
    }
    setActiveMediaTool(null)
    setMediaInput("")
    bodyRef.current?.focus()
  }

  const handleDirectMediaInsert = useCallback((url: string, tool: MediaTool) => {
    const html = buildMediaHtml(tool, url)
    if (!html) return
    insertHtmlAtCursor(html)
    if (tool === "image") {
      setType("image")
      fetchTagSuggestions(url, "image")
    }
    setActiveMediaTool(null)
    setMediaInput("")
    bodyRef.current?.focus()
  }, [insertHtmlAtCursor, fetchTagSuggestions])

  const format = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value)
    bodyRef.current?.focus()
  }

  const addTag = () => {
    const t = tagInput.trim().toLowerCase()
    if (t && !tags.includes(t)) setTags((p) => [...p, t])
    setTagInput("")
  }

  const removeTag = (tag: string) => setTags((p) => p.filter((t) => t !== tag))

  const addSuggestedTag = (tag: string) => {
    if (!tags.includes(tag)) setTags((p) => [...p, tag])
  }

  const save = async () => {
    if (!title.trim()) { setError("Title is required"); return }
    const body = bodyRef.current?.innerHTML ?? ""
    if (!body.trim() || body === "<br>") { setError("Body cannot be empty"); return }
    setSaving(true); setError("")

    const payload = {
      title, body, type, tags,
    }
    const url    = editId ? `/api/content/${editId}` : "/api/content"
    const method = editId ? "PUT" : "POST"

    try {
      const res  = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to save")
      toast.success(editId ? "Note updated!" : "Note published!")
      router.push("/main")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed")
    }
    setSaving(false)
  }

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login")
  }, [status, router])

  if (status === "loading" || status === "unauthenticated") return null

  const toolbar = [
    { label: "B",  cmd: "bold",         cls: "font-bold",       kind: "format" as const },
    { label: "I",  cmd: "italic",       cls: "italic",          kind: "format" as const },
    { label: "U",  cmd: "underline",    cls: "underline",       kind: "format" as const },
    { label: "S",  cmd: "strikeThrough",cls: "line-through",    kind: "format" as const },
  ]
  const blockBtns = [
    { label: "H1",     cmd: "formatBlock",         value: "H2"      },
    { label: "H2",     cmd: "formatBlock",         value: "H3"      },
    { label: "• List", cmd: "insertUnorderedList", value: undefined  },
    { label: "1. List",cmd: "insertOrderedList",   value: undefined  },
  ]

  return (
    <div className="h-dvh w-dvw flex overflow-hidden" style={{ background: "var(--bg-primary)" }}>
      <div className="hidden md:block md:w-[220px] flex-shrink-0 h-full"><SideBar /></div>
      <Toaster position="bottom-right" reverseOrder />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Medium-style top bar */}
        <header className="flex items-center justify-between px-6 py-3 border-b flex-shrink-0"
                style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
              Second<span style={{ color: "var(--accent)" }}>Brain</span>
            </span>
            <span className="text-sm px-2 py-0.5 rounded"
                  style={{ color: "var(--text-muted)", background: "var(--input-bg)" }}>
              {editId ? "Editing" : "New Draft"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>{wordCount} words</span>
            <button onClick={() => router.push("/main")}
                    className="px-4 py-1.5 text-sm rounded-full border transition-all"
                    style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
              Discard
            </button>
            <button onClick={save} disabled={saving}
                    className="px-5 py-1.5 text-sm text-white rounded-full font-medium transition-all hover:shadow disabled:opacity-60"
                    style={{ background: "var(--accent)" }}>
              {saving ? "Saving..." : editId ? "Update" : "Publish"}
            </button>
          </div>
        </header>

        {/* Formatting toolbar */}
        <EditorToolbar
          toolbar={toolbar}
          blockBtns={blockBtns}
          type={type}
          onFormat={format}
          onTypeChange={setType}
        >
          <MediaToolbar
            activeMediaTool={activeMediaTool}
            mediaInput={mediaInput}
            mediaInputRef={mediaInputRef}
            onOpenTool={(tool) => { saveSelection(); openMediaPopover(tool) }}
            onMediaInputChange={setMediaInput}
            onConfirmInsert={confirmMediaInsert}
            onDirectUpload={handleDirectMediaInsert}
          />
        </EditorToolbar>

        {/* Writing area */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-8 pt-10 pb-20">

            {/* Title */}
            <input
              type="text"
              placeholder="Title"
              className="w-full text-4xl font-bold mb-6 border-0 bg-transparent focus:outline-none"
              style={{
                color:      title ? "var(--text-primary)" : "var(--text-muted)",
                fontFamily: "Georgia, serif",
              }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <EditorBody
              bodyRef={bodyRef}
              onInput={() => {
                countWords()
                saveSelection()
              }}
              onKeyUp={saveSelection}
              onMouseUp={saveSelection}
              onFocus={saveSelection}
              onDropMedia={handleDirectMediaInsert}
            />

            {/* Tags */}
            <TagInput
              tags={tags}
              tagInput={tagInput}
              suggestedTags={suggestedTags}
              suggestingTags={suggestingTags}
              onTagInputChange={setTagInput}
              onAddTag={addTag}
              onRemoveTag={removeTag}
              onAddSuggestedTag={addSuggestedTag}
            />

            {error && <p className="mt-4 text-red-500 text-sm">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}