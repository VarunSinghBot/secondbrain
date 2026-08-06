import { WebSocketServer, WebSocket } from "ws"

const PORT = process.env.CHAT_PORT ? parseInt(process.env.CHAT_PORT) : 8080

interface Client {
  socket:   WebSocket
  name:     string
  roomId:   string
  userId?:  string
}

const rooms = new Map<string, Set<Client>>()

const wss = new WebSocketServer({ port: PORT }, () => {
  console.log(`SecondBrain Chat WebSocket server running on port ${PORT}`)
})

function broadcast(roomId: string, message: object, exclude?: WebSocket) {
  const room = rooms.get(roomId)
  if (!room) return
  const payload = JSON.stringify(message)
  room.forEach((client) => {
    if (client.socket !== exclude && client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(payload)
    }
  })
}

function getRoomMemberCount(roomId: string): number {
  return rooms.get(roomId)?.size ?? 0
}

wss.on("connection", (socket: WebSocket) => {
  let currentClient: Client | null = null

  socket.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      const { type, payload } = msg

      if (type === "join") {
        const { name, roomId, userId } = payload
        if (!name || !roomId) return

        currentClient = { socket, name, roomId, userId }

        if (!rooms.has(roomId)) rooms.set(roomId, new Set())
        rooms.get(roomId)!.add(currentClient)

        // Notify room
        broadcast(roomId, {
          type: "system",
          payload: { message: `${name} joined the room`, members: getRoomMemberCount(roomId) },
        }, socket)

        // Confirm join to the connecting client
        socket.send(JSON.stringify({
          type: "joined",
          payload: { roomId, name, members: getRoomMemberCount(roomId) },
        }))
      }

      if (type === "chat") {
        if (!currentClient) return
        const { content } = payload

        // Broadcast to everyone in room including sender for consistency
        broadcast(currentClient.roomId, {
          type: "chat",
          payload: {
            content,
            name:     currentClient.name,
            senderId: currentClient.userId ?? currentClient.name,
            roomId:   currentClient.roomId,
            timestamp: new Date().toISOString(),
          },
        }, socket) // Exclude sender socket to avoid duplicate messages
      }

      if (type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }))
      }

    } catch (e) {
      console.error("Invalid message:", e)
    }
  })

  socket.on("close", () => {
    if (!currentClient) return
    const { name, roomId } = currentClient
    rooms.get(roomId)?.delete(currentClient)
    if (rooms.get(roomId)?.size === 0) rooms.delete(roomId)
    broadcast(roomId, {
      type: "system",
      payload: { message: `${name} left the room`, members: getRoomMemberCount(roomId) },
    })
    currentClient = null
  })

  socket.on("error", (err) => console.error("WebSocket error:", err))
})
