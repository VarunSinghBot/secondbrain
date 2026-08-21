"use client"
import { useEffect, useState, useRef } from "react"
import { useSession } from "next-auth/react"
import { useParams, useRouter } from "next/navigation"
import SideBar from "@/components/SideBar"
import { ArrowLeft, MessageCircle, Send } from "lucide-react"

interface Message {
  id: string
  content: string
  senderId: string
  createdAt: string
  sender: { id: string; name: string | null; username: string | null; image: string | null }
}

interface Friend {
  id: string
  name: string | null
  username: string | null
  email: string | null
  image: string | null
}

export default function DMPage() {
  const { friendId }       = useParams<{ friendId: string }>()
  const { data: session }  = useSession()
  const router              = useRouter()
  const [friend,    setFriend]    = useState<Friend | null>(null)
  const [messages,  setMessages]  = useState<Message[]>([])
  const [input,     setInput]     = useState("")
  const [loading,   setLoading]   = useState(true)
  const [sending,   setSending]   = useState(false)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const wsRef      = useRef<WebSocket | null>(null)

  // Load friend info + message history
  useEffect(() => {
    if (!friendId) return
    ;(async () => {
      setLoading(true)
      const [friendRes, msgRes] = await Promise.all([
        fetch(`/api/friends/${friendId}/info`),
        fetch(`/api/messages/${friendId}`),
      ])
      if (friendRes.ok) setFriend(await friendRes.json())
      if (msgRes.ok)    setMessages(await msgRes.json())
      setLoading(false)
    })()
  }, [friendId])

  // WebSocket for real-time
  useEffect(() => {
    if (!session?.user?.id || !friendId) return
    const chatUrl = process.env.NEXT_PUBLIC_CHAT_URL?.replace("http", "ws").replace(":5174", ":8080") ?? "ws://localhost:8080"
    const ws      = new WebSocket(chatUrl)
    wsRef.current = ws

    const roomId = [session.user.id, friendId].sort().join(":")

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", payload: { name: session.user?.name ?? "User", roomId } }))
    }

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === "chat" && msg.payload?.senderId !== session.user?.id) {
        setMessages((p) => [...p, {
          id: Date.now().toString(),
          content: msg.payload.content,
          senderId: msg.payload.senderId,
          createdAt: new Date().toISOString(),
          sender: { id: msg.payload.senderId, name: msg.payload.name, username: null, image: null },
        }])
      }
    }

    return () => ws.close()
  }, [session, friendId])

  // Auto scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const send = async () => {
    if (!input.trim() || !session?.user?.id) return
    setSending(true)
    const content = input.trim()
    setInput("")

    // Save to DB
    const res = await fetch("/api/messages", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ receiverId: friendId, content }),
    })

    if (res.ok) {
      const saved = await res.json()
      setMessages((p) => [...p, saved])

      // Send via WebSocket for real-time delivery
      wsRef.current?.send(JSON.stringify({
        type: "chat",
        payload: { content, senderId: session.user.id, name: session.user.name },
      }))
    }
    setSending(false)
  }

  const myId = session?.user?.id

  return (
    <div className="h-dvh w-dvw flex overflow-hidden" style={{ background: "var(--bg-primary)" }}>
      <div className="hidden md:block md:w-[220px] flex-shrink-0 h-full"><SideBar /></div>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center gap-3 px-6 py-4 border-b" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <button onClick={() => router.back()} aria-label="Go back" className="mr-1 hover:opacity-70 transition-opacity" style={{ color: "var(--text-secondary)" }}>
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0" style={{ background: "var(--accent)" }}>
            {(friend?.name ?? friend?.username ?? "F").charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{friend?.name ?? friend?.username ?? "Friend"}</p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{friend?.email}</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-8 h-8 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <MessageCircle className="w-12 h-12 opacity-40" style={{ color: "var(--text-muted)" }} strokeWidth={1.5} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>No messages yet. Say hi!</p>
            </div>
          ) : messages.map((msg) => {
            const isMe = msg.senderId === myId
            return (
              <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[65%] px-4 py-2.5 rounded-2xl text-sm ${isMe ? "rounded-br-sm" : "rounded-bl-sm"}`}
                     style={isMe
                       ? { background: "var(--accent)", color: "#fff" }
                       : { background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
                  <p>{msg.content}</p>
                  <p className={`text-xs mt-1 ${isMe ? "text-white/60" : ""}`} style={!isMe ? { color: "var(--text-muted)" } : {}}>
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 flex items-center gap-3 px-6 py-4 border-t" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <input
            type="text"
            placeholder="Type a message..."
            className="flex-1 h-10 rounded-full px-4 text-sm border focus:outline-none transition-colors"
            style={{ background: "var(--input-bg)", borderColor: "var(--border)", color: "var(--text-primary)" }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            aria-label="Send message"
            className="w-10 h-10 rounded-full flex items-center justify-center text-white disabled:opacity-50 transition-all hover:shadow"
            style={{ background: "var(--accent)" }}
          >
            <Send className="w-4 h-4" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </div>
  )
}