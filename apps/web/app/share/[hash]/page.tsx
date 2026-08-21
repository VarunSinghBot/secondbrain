import { prisma } from "@/lib/db"
import { Lock, Clock, FileQuestion, Brain } from "lucide-react"

export default async function SharePage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params

  // 1. Look for per-note share by shareHash
  const note = await prisma.content.findUnique({
    where: { shareHash: hash },
    include: {
      tags: true,
      author: { select: { name: true, username: true, email: true } },
    },
  })

  if (note) {
    if (!note.shareEnabled) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#faf9f6] p-4 text-center">
          <Lock className="w-12 h-12 mb-4 text-gray-400" strokeWidth={1.5} />
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Sharing Disabled</h1>
          <p className="text-gray-500 max-w-md">The owner of this note has turned off public link sharing.</p>
        </div>
      )
    }

    if (note.shareExpiresAt && new Date(note.shareExpiresAt) < new Date()) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#faf9f6] p-4 text-center">
          <Clock className="w-12 h-12 mb-4 text-gray-400" strokeWidth={1.5} />
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Link Expired</h1>
          <p className="text-gray-500 max-w-md">This shared note link has expired. Ask the author to extend or generate a new link.</p>
        </div>
      )
    }

    const TYPE_COLOR: Record<string, string> = {
      article: "#6366f1", image: "#ec4899", audio: "#f59e0b", video: "#10b981",
    }
    const color = TYPE_COLOR[note.type] ?? "#e1434b"

    return (
      <div className="min-h-screen bg-[#faf9f6] py-12 px-4">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="mb-10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: "#e1434b" }}>
                <Brain className="w-5 h-5" strokeWidth={2.25} />
              </div>
              <h1 className="text-xl font-bold" style={{ color: "#e1434b" }}>Second Brain</h1>
              <span className="text-sm text-gray-400 ml-2">— Shared Note</span>
            </div>
            <span className="text-xs text-gray-500">By {note.author.name ?? note.author.username ?? "Anonymous"}</span>
          </div>

          <article className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="h-1.5 w-full" style={{ background: color }} />

            <div className="p-8">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded-full text-white" style={{ background: color }}>
                  {note.type}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(note.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                </span>
              </div>

              <h2 className="text-3xl font-bold text-gray-900 mb-6" style={{ fontFamily: "Georgia, serif" }}>
                {note.title}
              </h2>

              {note.tags && note.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-6">
                  {note.tags.map((t) => (
                    <span key={t.id} className="text-xs px-3 py-1 rounded-full border border-gray-200 text-gray-500">
                      #{t.tagName}
                    </span>
                  ))}
                </div>
              )}

              <div className="h-px bg-gray-100 mb-6" />

              <div
                className="prose max-w-none text-lg leading-8 text-gray-700
                  [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-xl [&_img]:my-4
                  [&_video]:max-w-full [&_video]:rounded-xl [&_video]:my-4
                  [&_audio]:w-full [&_audio]:my-4
                  [&_iframe]:w-full [&_iframe]:aspect-video [&_iframe]:rounded-xl [&_iframe]:my-4
                  [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-3
                  [&_h3]:text-xl [&_h3]:font-bold [&_h3]:mt-4 [&_h3]:mb-2
                  [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3
                  [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-3
                  [&_li]:my-1
                  [&_strong]:font-bold
                  [&_em]:italic"
                dangerouslySetInnerHTML={{ __html: note.body }}
              />

              {note.mediaUrl && (
                <div className="mt-8 rounded-xl overflow-hidden border border-gray-100">
                  {note.type === "image" && (
                    <img src={note.mediaUrl} alt={note.title} className="w-full object-cover" referrerPolicy="no-referrer" />
                  )}
                  {note.type === "video" && (
                    (() => {
                      const match = note.mediaUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
                      return match
                        ? <iframe src={`https://www.youtube.com/embed/${match[1]}`} className="w-full aspect-video" allowFullScreen title={note.title} />
                        : <video src={note.mediaUrl} controls className="w-full" />
                    })()
                  )}
                  {note.type === "audio" && (
                    <audio src={note.mediaUrl} controls className="w-full p-4" />
                  )}
                </div>
              )}
            </div>
          </article>

          <p className="text-center text-xs text-gray-400 mt-12">
            Shared via <span className="font-semibold" style={{ color: "#e1434b" }}>Second Brain App</span>
          </p>
        </div>
      </div>
    )
  }

  // 2. Fallback: Check global Link model
  const globalLink = await prisma.link.findUnique({
    where: { hash },
    include: { author: { include: { Content: { include: { tags: true } } } } },
  })

  if (!globalLink || !globalLink.author.Content.length) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#faf9f6] p-4 text-center">
        <FileQuestion className="w-12 h-12 mb-4 text-gray-400" strokeWidth={1.5} />
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Note Not Found</h1>
        <p className="text-gray-500 max-w-md">This link is invalid or the note has been removed.</p>
      </div>
    )
  }

  const content = globalLink.author.Content
  const TYPE_COLOR: Record<string, string> = {
    article: "#6366f1", image: "#ec4899", audio: "#f59e0b", video: "#10b981",
  }

  return (
    <div className="min-h-screen bg-[#faf9f6] py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-10 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: "#e1434b" }}>
            <Brain className="w-5 h-5" strokeWidth={2.25} />
          </div>
          <h1 className="text-xl font-bold" style={{ color: "#e1434b" }}>Second Brain</h1>
          <span className="text-sm text-gray-400 ml-2">— Shared Notes</span>
        </div>

        <div className="flex flex-col gap-8">
          {content.map((item) => {
            const color = TYPE_COLOR[item.type] ?? "#e1434b"
            return (
              <article key={item.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="h-1.5 w-full" style={{ background: color }} />
                <div className="p-8">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-xs font-semibold uppercase tracking-wider px-3 py-1 rounded-full text-white" style={{ background: color }}>
                      {item.type}
                    </span>
                  </div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-6" style={{ fontFamily: "Georgia, serif" }}>{item.title}</h2>
                  <div className="prose max-w-none text-lg leading-8 text-gray-700" dangerouslySetInnerHTML={{ __html: item.body }} />
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}