import type { NextAuthConfig } from "next-auth"
import { NextResponse } from "next/server"

export const authConfig: NextAuthConfig = {
  pages: { signIn: "/login" },
  providers: [], // providers with DB access go in auth.ts
  callbacks: {
    authorized({ auth, request }) {
      const loggedIn = !!auth?.user
      const { pathname } = request.nextUrl

      const isProtectedPage = ["/main", "/addItem", "/settings", "/note"].some((p) =>
        pathname.startsWith(p)
      )
      const isProtectedApi =
        pathname.startsWith("/api/") &&
        !pathname.startsWith("/api/auth/") &&
        !pathname.startsWith("/api/links/") &&
        !pathname.startsWith("/api/shared/")

      if (!loggedIn) {
        // For API routes return a proper JSON 401 — NOT a redirect.
        // A redirect causes the browser to follow to /login (HTML) which
        // breaks every fetch() call that expects JSON.
        if (isProtectedApi) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }
        // For protected pages, fall through to the default redirect to /login
        if (isProtectedPage) return false
      }

      return true
    },
  },
}
