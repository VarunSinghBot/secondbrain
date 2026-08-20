import { Brain, Sparkles, Share2, Tags } from "lucide-react"

const FEATURES = [
  { icon: Sparkles, text: "Ask questions across all your notes" },
  { icon: Tags,      text: "Tag once, find it a hundred ways" },
  { icon: Share2,    text: "Share a note or your whole brain" },
]

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh w-full flex items-center justify-center overflow-hidden" style={{ background: "var(--bg-primary)" }}>
      <div className="ambient-glow" />

      {/* Faint dot-grid texture, theme-aware (uses --border), fades out toward the edges */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage: "radial-gradient(ellipse 75% 65% at 50% 40%, black 30%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 75% 65% at 50% 40%, black 30%, transparent 100%)",
        }}
      />

      {/* Bounded + centered so wide screens don't stretch this into two disconnected halves */}
      <div className="relative z-[1] w-full max-w-[1100px] flex items-center justify-between gap-12 lg:gap-20 px-6 lg:px-12 py-12">
        {/* Brand panel — desktop only, shared by /login and /signup */}
        <div className="hidden lg:flex flex-col flex-1 max-w-md">
          <div className="h-14 w-14 rounded-2xl flex items-center justify-center mb-6" style={{ background: "var(--accent)" }}>
            <Brain className="w-8 h-8 text-white" strokeWidth={2} />
          </div>
          <h1 className="text-4xl font-bold mb-3" style={{ color: "var(--text-primary)" }}>Second Brain</h1>
          <p className="text-base mb-10" style={{ color: "var(--text-secondary)" }}>
            Every note, image, and recording — in one place, and searchable by what&apos;s actually in it.
          </p>
          <div className="flex flex-col gap-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--input-bg)", border: "1px solid var(--border)" }}>
                  <Icon className="w-4 h-4" style={{ color: "var(--accent)" }} strokeWidth={2} />
                </div>
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Form panel — login/page.tsx or signup/page.tsx renders here as {children} */}
        <div className="relative w-full lg:w-[420px] flex-shrink-0 flex items-center justify-center">
          {/* Soft spotlight so the card reads as anchored, not floating alone */}
          <div
            className="absolute inset-0 -z-[1] pointer-events-none"
            style={{ background: "radial-gradient(340px circle at 50% 45%, color-mix(in srgb, var(--accent) 11%, transparent), transparent 70%)" }}
          />
          {children}
        </div>
      </div>
    </div>
  )
}