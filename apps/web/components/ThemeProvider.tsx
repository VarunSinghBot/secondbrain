"use client"
import { useEffect } from "react"
import { useSelector } from "react-redux"
import type { RootState } from "@/store/store"

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSelector((s: RootState) => s.theme.theme)

  useEffect(() => {
    const html = document.documentElement
    html.classList.remove("theme-light", "theme-dark", "theme-sepia", "theme-ocean")
    html.classList.add(`theme-${theme}`)
  }, [theme])

  return <>{children}</>
}
