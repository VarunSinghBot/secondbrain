"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import toast, { Toaster } from "react-hot-toast"

export default function SignupPage() {
  const [username, setUsername] = useState("")
  const [email,    setEmail]    = useState("")
  const [pw,       setPw]       = useState("")
  const [rePw,     setRePw]     = useState("")
  const [error,    setError]    = useState("")
  const [loading,  setLoading]  = useState(false)
  const router = useRouter()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError("")
    if (pw !== rePw) { setError("Passwords do not match"); return }
    setLoading(true)
    try {
      const res  = await fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, email, password: pw }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Signup failed")
      toast.success("Account created! Logging you in...")
      await signIn("credentials", { email, password: pw, callbackUrl: "/main" })
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Signup failed"); setLoading(false) }
  }

  const googleLogin = () => signIn("google", { callbackUrl: "/main" })

  return (
    <>
      <Toaster position="bottom-right" reverseOrder />
      <div className="w-full min-h-[560px] text-black/75 rounded-xl bg-white/40 backdrop-blur border border-white/30 shadow-xl flex flex-col items-center justify-start py-8 px-6 transition-all duration-300">
        <h1 className="text-[#e1434b] text-4xl font-bold mb-5">Sign Up</h1>
        <button onClick={googleLogin} className="w-[88%] h-[44px] flex items-center justify-center gap-3 border border-gray-300 bg-white hover:bg-gray-50 rounded-lg mb-4 text-gray-700 font-medium shadow-sm transition-all duration-200 hover:shadow-md">
          <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Continue with Google
        </button>
        <div className="w-[88%] flex items-center gap-3 mb-4"><div className="flex-1 h-px bg-gray-200"/><span className="text-gray-400 text-sm">or</span><div className="flex-1 h-px bg-gray-200"/></div>
        {[
          { label: "Username", val: username, set: setUsername, type: "text",     ph: "Your name" },
          { label: "Email",    val: email,    set: setEmail,    type: "email",    ph: "you@example.com" },
          { label: "Password", val: pw,       set: setPw,       type: "password", ph: "••••••••" },
          { label: "Confirm",  val: rePw,     set: setRePw,     type: "password", ph: "••••••••" },
        ].map(({ label, val, set, type, ph }) => (
          <label key={label} className="w-[88%] flex flex-col text-base font-medium mb-3">
            {label}
            <input type={type} className="mt-1 w-full rounded-lg p-2.5 border border-gray-200 bg-white/70 focus:border-[#e1434b] focus:outline-none transition-colors" placeholder={ph} value={val} onChange={(e) => set(e.target.value)} />
          </label>
        ))}
        {error && <p className="w-[88%] text-red-500 text-sm">{error}</p>}
        <button disabled={loading} onClick={submit} className="w-[88%] h-[44px] bg-[#e1434b] hover:bg-[#c73038] disabled:opacity-60 text-white rounded-lg mt-3 font-semibold transition-all duration-200 hover:shadow-lg">
          {loading ? "Creating..." : "Create Account"}
        </button>
        <p className="text-sm mt-4 text-gray-500">Have an account? <a href="/login" className="text-[#e1434b] font-medium hover:underline">Login</a></p>
      </div>
    </>
  )
}
