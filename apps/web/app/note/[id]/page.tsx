import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import NoteDetailClient from "./NoteDetailClient"

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id }  = await params
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const note = await prisma.content.findUnique({
    where:   { id },
    include: { tags: true },
  })

  // Allow viewing if owner OR shared with this user
  if (!note) redirect("/main")
  const isOwner  = note.authorId === session.user.id
  const isShared = !isOwner && await prisma.noteShare.findUnique({
    where: { noteId_sharedWithId: { noteId: id, sharedWithId: session.user.id } },
  })
  if (!isOwner && !isShared) redirect("/main")

  return <NoteDetailClient note={JSON.parse(JSON.stringify(note))} userId={session.user.id} />
}
