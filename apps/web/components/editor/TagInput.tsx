"use client"

import { X, Plus } from "lucide-react"

export default function TagInput({
  tags,
  tagInput,
  suggestedTags = [],
  onTagInputChange,
  onAddTag,
  onRemoveTag,
  onAddSuggestedTag,
}: {
  tags: string[]
  tagInput: string
  suggestedTags?: string[]
  onTagInputChange: (value: string) => void
  onAddTag: () => void
  onRemoveTag: (tag: string) => void
  onAddSuggestedTag?: (tag: string) => void
}) {
  const unaddedSuggestions = suggestedTags.filter((st) => !tags.includes(st))

  return (
    <div className="mt-10 pt-6 border-t" style={{ borderColor: "var(--border)" }}>
      <p className="text-sm font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>Tags</p>

      <div className="flex flex-wrap gap-2 mb-3">
        {tags.map((tag) => (
          <span key={tag} className="flex items-center gap-1 text-sm px-3 py-1 rounded-full border"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
            #{tag}
            <button onClick={() => onRemoveTag(tag)} aria-label={`Remove tag ${tag}`}
                    className="ml-1 hover:text-red-500 transition-colors">
              <X className="w-3 h-3" strokeWidth={2.5} />
            </button>
          </span>
        ))}
      </div>

      {unaddedSuggestions.length > 0 && (
        <div className="mb-4 p-3 rounded-xl border flex flex-col gap-2"
             style={{ borderColor: "var(--accent)", background: "rgba(99, 102, 241, 0.05)" }}>
          <p className="text-xs font-semibold flex items-center gap-1" style={{ color: "var(--accent)" }}>
            ✨ AI Suggested Tags for Image / Content:
          </p>
          <div className="flex flex-wrap gap-2">
            {unaddedSuggestions.map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => onAddSuggestedTag?.(st)}
                className="text-xs px-2.5 py-1 rounded-full border transition-all hover:scale-105 font-medium"
                style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "var(--bg-card)" }}
              >
                + #{st}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <input type="text" placeholder="Add a tag..."
               className="flex-1 h-9 px-3 rounded-lg border text-sm focus:outline-none"
               style={{ background: "var(--input-bg)", borderColor: "var(--border)", color: "var(--text-primary)" }}
               value={tagInput}
               onChange={(e) => onTagInputChange(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onAddTag())} />
        <button onClick={onAddTag}
                className="px-4 h-9 rounded-lg text-sm font-medium text-white transition-all flex items-center gap-1"
                style={{ background: "var(--accent)" }}>
          <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
          Add
        </button>
      </div>
    </div>
  )
}