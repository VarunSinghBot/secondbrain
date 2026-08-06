"use client"

export default function TagInput({
  tags,
  tagInput,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
}: {
  tags: string[]
  tagInput: string
  onTagInputChange: (value: string) => void
  onAddTag: () => void
  onRemoveTag: (tag: string) => void
}) {
  return (
    <div className="mt-10 pt-6 border-t" style={{ borderColor: "var(--border)" }}>
      <p className="text-sm font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>Tags</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {tags.map((tag) => (
          <span key={tag} className="flex items-center gap-1 text-sm px-3 py-1 rounded-full border"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
            #{tag}
            <button onClick={() => onRemoveTag(tag)}
                    className="ml-1 text-xs hover:text-red-500 transition-colors">✕</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="text" placeholder="Add a tag..."
               className="flex-1 h-9 px-3 rounded-lg border text-sm focus:outline-none"
               style={{ background: "var(--input-bg)", borderColor: "var(--border)", color: "var(--text-primary)" }}
               value={tagInput}
               onChange={(e) => onTagInputChange(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onAddTag())} />
        <button onClick={onAddTag}
                className="px-4 h-9 rounded-lg text-sm font-medium text-white transition-all"
                style={{ background: "var(--accent)" }}>
          Add
        </button>
      </div>
    </div>
  )
}
