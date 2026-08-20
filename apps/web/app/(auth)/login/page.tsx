"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import toast, { Toaster } from "react-hot-toast"
import { Brain, Eye, EyeOff } from "lucide-react"
import LoadingScreen from "@/components/LoadingScreen"

export default function LoginPage() {
  const [email,    setEmail]    = useState("")
  const [password, setPassword] = useState("")
  const [showPw,   setShowPw]   = useState(false)
  const [error,    setError]    = useState("")
  const [loading,  setLoading]  = useState(false)
  const router = useRouter()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setLoading(true)
    const res = await signIn("credentials", { email, password, redirect: false })
    if (res?.error) { setLoading(false); setError("Invalid email or password"); return }
    toast.success("Logged in!")
    router.push("/main")
  }

  const googleLogin = () => signIn("google", { callbackUrl: "/main" })

  return (
    <>
      <Toaster position="bottom-right" reverseOrder />
      <div className="w-full max-w-sm min-h-[460px] rounded-2xl p-8 flex flex-col justify-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
        {loading ? (
          <LoadingScreen label="Logging in..." fullScreen={false} />
        ) : (
          <>
            {/* Mobile brand mark — the layout's brand panel is hidden below lg */}
            <div className="flex lg:hidden items-center gap-2 mb-6">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--accent)" }}>
                <Brain className="w-5 h-5 text-white" strokeWidth={2} />
              </div>
              <span className="font-bold" style={{ color: "var(--accent)" }}>Second Brain</span>
            </div>

            <h2 className="text-2xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>Welcome back</h2>

            <button
              onClick={googleLogin}
              className="w-full h-11 flex items-center justify-center gap-3 rounded-lg font-medium mb-4 transition-all duration-200 hover:shadow-md"
              style={{ background: "#ffffff", border: "1px solid var(--border)", color: "#3c4043" }}
            >
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Continue with Google
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>or</span>
              <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
            </div>

            <form onSubmit={submit} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                Email
                <input
                  type="email"
                  className="h-10 px-3 rounded-lg text-sm focus:outline-none focus:ring-2 transition-all"
                  style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", "--tw-ring-color": "var(--accent)" } as React.CSSProperties}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm font-medium relative" style={{ color: "var(--text-secondary)" }}>
                Password
                <input
                  type={showPw ? "text" : "password"}
                  className="h-10 px-3 pr-10 rounded-lg text-sm focus:outline-none focus:ring-2 transition-all"
                  style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", "--tw-ring-color": "var(--accent)" } as React.CSSProperties}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="absolute right-3 top-[34px] transition-colors hover:opacity-70"
                  style={{ color: "var(--text-muted)" }}
                  onClick={() => setShowPw((p) => !p)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </label>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button
                type="submit"
                className="h-11 rounded-lg font-semibold text-white mt-1 transition-all duration-200 hover:shadow-lg"
                style={{ background: "var(--accent)" }}
              >
                Login
              </button>
            </form>

            <p className="text-sm mt-5 text-center" style={{ color: "var(--text-muted)" }}>
              No account? <a href="/signup" className="font-medium hover:underline" style={{ color: "var(--accent)" }}>Sign Up</a>
            </p>
          </>
        )}
      </div>
    </>
  )
}