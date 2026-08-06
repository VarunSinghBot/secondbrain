"use client"
import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import SideBar from "@/components/SideBar"
import TopBar  from "@/components/TopBar"
import Content from "@/components/Content"
import RagAskBox from "@/components/RagAskBox"

export default function MainPage() {
  const [filterType,   setFilterType]   = useState<string | null>(null)
  const [searchQuery,  setSearchQuery]  = useState("")
  const { status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login")
  }, [status, router])

  if (status === "loading" || status === "unauthenticated") return null

  return (
    <div className="h-full w-full flex overflow-hidden transition-colors duration-300" style={{ background: "var(--bg-primary)" }}>
      {/* Sidebar */}
      <div className="w-[220px] flex-shrink-0 h-full"><SideBar onFilter={setFilterType} /></div>

      {/* Main content */}
      <div className="flex-1 h-full flex flex-col overflow-hidden">
        <div className="h-[64px] flex-shrink-0"><TopBar onSearch={setSearchQuery} searchValue={searchQuery} /></div>
        <main className="flex-1 overflow-y-auto pt-4 page-enter">
          {/* Stats bar */}
          <div className="px-6 mb-4 flex items-center justify-between">
            <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>My Notes</h1>
          </div>
          <div className="px-6">
            <RagAskBox />
          </div>
          <Content filterType={filterType} searchQuery={searchQuery} />
        </main>
      </div>
    </div>
  )
}
