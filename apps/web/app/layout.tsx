import type { Metadata } from "next"
import "./globals.css"
import { ReduxProvider } from "@/components/ReduxProvider"
import { ThemeProvider } from "@/components/ThemeProvider"
import { SessionProvider } from "next-auth/react"
import { auth } from "@/auth"

export const metadata: Metadata = {
  title: "Second Brain App",
  description: "Multi-modal note-taking with AI recall",
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  return (
    <html lang="en">
      <body>
        <SessionProvider session={session}>
          <ReduxProvider>
            <ThemeProvider>
              {children}
            </ThemeProvider>
          </ReduxProvider>
        </SessionProvider>
      </body>
    </html>
  )
}