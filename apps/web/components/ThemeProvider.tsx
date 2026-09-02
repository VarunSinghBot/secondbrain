"use client"
import { useEffect } from "react"
import { useSelector, useDispatch } from "react-redux"
import type { RootState } from "@/store/store"
import { hydrateTheme } from "@/store/reducers/themeSlice"

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSelector((s: RootState) => s.theme.theme)
  const dispatch = useDispatch()

  // Runs once, after mount — i.e. after the client's first render has
  // already matched the server's default-theme output. Only then do we
  // bring in whatever was actually persisted, so there's never a render
  // where server and client disagree (see themeSlice.ts's hydrateTheme).
  useEffect(() => {
    const storedTheme  = localStorage.getItem("sb_theme")
    const storedLayout = localStorage.getItem("sb_layout")
    if (storedTheme || storedLayout) {
      dispatch(hydrateTheme({
        theme:  storedTheme  as "light" | "dark" | "sepia" | "ocean" | null ?? undefined,
        layout: storedLayout as "compact" | "comfortable" | "spacious" | null ?? undefined,
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const html = document.documentElement
    html.classList.remove("theme-light", "theme-dark", "theme-sepia", "theme-ocean")
    html.classList.add(`theme-${theme}`)
  }, [theme])

  return <>{children}</>
}