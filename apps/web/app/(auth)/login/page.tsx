"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import toast, { Toaster } from "react-hot-toast"

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
    setLoading(false)
    if (res?.error) { setError("Invalid email or password"); return }
    toast.success("Logged in!")
    router.push("/main")
  }

  const googleLogin = () => signIn("google", { callbackUrl: "/main" })

  const Eye = ({ show }: { show: boolean }) => show
    ? <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width={20} height={20}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
    : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width={20} height={20}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-5 0-9.27-3.11-11-7.5a11.64 11.64 0 012.99-4.36m2.12-1.7A9.97 9.97 0 0112 5c5 0 9.27 3.11 11 7.5a11.64 11.64 0 01-4.21 5.09M15 12a3 3 0 11-6 0 3 3 0 016 0zM3 3l18 18"/></svg>

  return (
    <>
      <Toaster position="bottom-right" reverseOrder />
      <div className="w-full min-h-[580px] text-black/75 rounded-xl bg-white/40 backdrop-blur border border-white/30 shadow-xl flex flex-col items-center justify-start py-8 px-6 transition-all duration-300">
        <h1 className="text-[#e1434b] text-4xl font-bold mb-6">Login</h1>

        {/* Google OAuth */}
        <button
          onClick={googleLogin}
          className="w-[88%] h-[44px] flex items-center justify-center gap-3 border border-gray-300 bg-white hover:bg-gray-50 rounded-lg mb-4 text-gray-700 font-medium shadow-sm transition-all duration-200 hover:shadow-md"
        >
          <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Continue with Google
        </button>

        <div className="w-[88%] flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-gray-400 text-sm">or</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        <label className="w-[88%] flex flex-col text-base font-medium mb-3">
          Email
          <input type="email" className="mt-1 w-full rounded-lg p-2.5 border border-gray-200 bg-white/70 focus:border-[#e1434b] focus:outline-none transition-colors" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label className="w-[88%] flex flex-col text-base font-medium mb-1 relative">
          Password
          <input type={showPw ? "text" : "password"} className="mt-1 w-full rounded-lg p-2.5 border border-gray-200 bg-white/70 pr-10 focus:border-[#e1434b] focus:outline-none transition-colors" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="button" className="absolute right-3 top-[58%] text-gray-400 hover:text-gray-600 transition-colors" onClick={() => setShowPw((p) => !p)}>
            <Eye show={showPw} />
          </button>
        </label>

        {error && <p className="w-[88%] text-red-500 text-sm mt-2">{error}</p>}

        <button
          disabled={loading}
          onClick={submit}
          className="w-[88%] h-[44px] bg-[#e1434b] hover:bg-[#c73038] disabled:opacity-60 text-white rounded-lg mt-5 font-semibold transition-all duration-200 hover:shadow-lg"
        >
          {loading ? "Logging in..." : "Login"}
        </button>
        <p className="text-sm mt-4 text-gray-500">No account? <a href="/signup" className="text-[#e1434b] font-medium hover:underline">Sign Up</a></p>
      </div>
    </>
  )
}
