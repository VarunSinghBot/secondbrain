"use client"
import { useState, useEffect } from "react"
import { useDispatch, useSelector } from "react-redux"
import { setTheme, setLayout } from "@/store/reducers/themeSlice"
import type { RootState } from "@/store/store"
import SideBar from "@/components/SideBar"
import { useSession } from "next-auth/react"
import toast, { Toaster } from "react-hot-toast"
import { Camera, Check, Grid3x3, Columns3, Columns2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"

const THEMES = [
  { id: "light",  label: "Light",  bg: "#ffffff", accent: "#e1434b", text: "#1a1a1a", desc: "Clean white" },
  { id: "dark",   label: "Dark",   bg: "#0f0f0f", accent: "#ff5a63", text: "#f0f0f0", desc: "Easy on eyes" },
  { id: "sepia",  label: "Sepia",  bg: "#f4f1ea", accent: "#c8553d", text: "#3c3020", desc: "Warm & cozy" },
  { id: "ocean",  label: "Ocean",  bg: "#f0f4f8", accent: "#2563eb", text: "#1a2f4a", desc: "Cool & calm" },
] as const

const LAYOUTS: { id: "compact" | "comfortable" | "spacious"; label: string; desc: string; icon: LucideIcon }[] = [
  { id: "compact",     label: "Compact",     desc: "4 columns, dense view",  icon: Grid3x3 },
  { id: "comfortable", label: "Comfortable", desc: "3 columns, balanced",    icon: Columns3 },
  { id: "spacious",    label: "Spacious",    desc: "2 columns, wide cards",  icon: Columns2 },
]

export default function SettingsPage() {
  const dispatch = useDispatch()
  const theme    = useSelector((s: RootState) => s.theme.theme)
  const layout   = useSelector((s: RootState) => s.theme.layout)
  const { data: session } = useSession()

  const [userAvatar, setUserAvatar] = useState<string | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data?.image) setUserAvatar(data.image)
      })
      .catch(() => {})
  }, [])

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingAvatar(true)
    const toastId = toast.loading("Uploading avatar to Cloudinary...")

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("folder", "secondbrain/avatars")

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Upload failed")

      const settingsRes = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: data.url }),
      })
      if (!settingsRes.ok) throw new Error("Failed to save avatar setting")

      setUserAvatar(data.url)
      toast.success("Profile avatar updated!", { id: toastId })
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Avatar upload failed", { id: toastId })
    } finally {
      setUploadingAvatar(false)
    }
  }

  const applyTheme = (t: typeof THEMES[number]["id"]) => {
    dispatch(setTheme(t))
    toast.success(`Theme changed to ${t}!`, { style: { border: "1px solid #fff", padding: "16px" } })
  }

  const applyLayout = (l: typeof LAYOUTS[number]["id"]) => {
    dispatch(setLayout(l))
    toast.success(`Layout changed to ${l}!`, { style: { border: "1px solid #fff", padding: "16px" } })
  }

  return (
    <div className="h-dvh w-dvw flex overflow-hidden transition-colors duration-300" style={{ background: "var(--bg-primary)" }}>
      <div className="hidden md:block md:w-[220px] flex-shrink-0 h-full"><SideBar /></div>
      <Toaster position="bottom-right" reverseOrder />

      <div className="flex-1 overflow-y-auto page-enter">
        <div className="max-w-2xl mx-auto px-8 py-10">
          <h1 className="text-3xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>Settings</h1>
          <p className="text-sm mb-8" style={{ color: "var(--text-muted)" }}>Customize your Second Brain experience</p>

          {/* Account */}
          <section className="mb-10">
            <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Account</h2>
            <div className="rounded-xl border p-5" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  {userAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={userAvatar}
                      alt="Avatar"
                      className="w-14 h-14 rounded-full object-cover border-2"
                      style={{ borderColor: "var(--accent)" }}
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold" style={{ background: "var(--accent)" }}>
                      {(session?.user?.name ?? session?.user?.email ?? "U").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{session?.user?.name ?? "User"}</p>
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>{session?.user?.email}</p>
                  </div>
                </div>

                <div>
                  <label className="cursor-pointer px-4 py-2 text-xs font-semibold rounded-lg text-white transition-all hover:opacity-90 inline-flex items-center gap-2" style={{ background: "var(--accent)" }}>
                    <Camera className="w-3.5 h-3.5" strokeWidth={2} />
                    {uploadingAvatar ? "Uploading..." : "Upload Avatar"}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      disabled={uploadingAvatar}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>
          </section>

          {/* Theme */}
          <section className="mb-10">
            <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Theme</h2>
            <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>Choose a colour theme for the app</p>
            <div className="grid grid-cols-2 gap-3">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => applyTheme(t.id)}
                  className={`relative rounded-xl border-2 p-4 text-left transition-all duration-200 hover:scale-[1.02] ${theme === t.id ? "ring-2" : ""}`}
                  style={{
                    background:   t.bg,
                    borderColor:  theme === t.id ? t.accent : "transparent",
                    outlineColor: t.accent,
                    boxShadow:    "var(--shadow)",
                  }}
                >
                  {theme === t.id && (
                    <span className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-white" style={{ background: t.accent }}>
                      <Check className="w-3 h-3" strokeWidth={3} />
                    </span>
                  )}
                  {/* Mini preview */}
                  <div className="flex gap-1 mb-3">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: t.accent }} />
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: t.text, opacity: 0.3 }} />
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: t.text, opacity: 0.15 }} />
                  </div>
                  <p className="font-semibold text-sm" style={{ color: t.text }}>{t.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: t.text, opacity: 0.6 }}>{t.desc}</p>
                </button>
              ))}
            </div>
          </section>

          {/* Layout */}
          <section className="mb-10">
            <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Layout</h2>
            <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>Choose how notes are displayed on the dashboard</p>
            <div className="flex flex-col gap-3">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => applyLayout(l.id)}
                  className="flex items-center gap-4 rounded-xl border-2 p-4 text-left transition-all duration-200 hover:opacity-80"
                  style={{
                    background:  "var(--bg-card)",
                    borderColor: layout === l.id ? "var(--accent)" : "var(--border)",
                  }}
                >
                  <l.icon className="w-6 h-6 flex-shrink-0" style={{ color: "var(--text-secondary)" }} strokeWidth={1.75} />
                  <div className="flex-1">
                    <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{l.label}</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>{l.desc}</p>
                  </div>
                  {layout === l.id && (
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-white flex-shrink-0" style={{ background: "var(--accent)" }}>
                      <Check className="w-3 h-3" strokeWidth={3} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}