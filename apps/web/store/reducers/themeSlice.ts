import { createSlice, type PayloadAction } from "@reduxjs/toolkit"

type Theme  = "light" | "dark" | "sepia" | "ocean"
type Layout = "compact" | "comfortable" | "spacious"

interface ThemeState { theme: Theme; layout: Layout }

// Server and the client's first render both need this exact same, static
// value — reading localStorage here (even guarded by `typeof window`)
// makes the server render "light"/"comfortable" while the client's first
// render already sees the real stored preference, a classic hydration
// mismatch. The real value is applied after mount instead, via
// hydrateTheme() from ThemeProvider's effect — see there for why.
const initialState: ThemeState = {
  theme:  "light",
  layout: "comfortable",
}

const themeSlice = createSlice({
  name: "theme",
  initialState,
  reducers: {
    setTheme(state, action: PayloadAction<Theme>) {
      state.theme = action.payload
      if (typeof window !== "undefined") localStorage.setItem("sb_theme", action.payload)
    },
    setLayout(state, action: PayloadAction<Layout>) {
      state.layout = action.payload
      if (typeof window !== "undefined") localStorage.setItem("sb_layout", action.payload)
    },
    // Client-only, dispatched once after mount (never during SSR or the
    // client's first render) to bring in whatever was actually persisted,
    // without ever making the first render disagree with the server's.
    hydrateTheme(state, action: PayloadAction<Partial<ThemeState>>) {
      if (action.payload.theme)  state.theme  = action.payload.theme
      if (action.payload.layout) state.layout = action.payload.layout
    },
  },
})

export const { setTheme, setLayout, hydrateTheme } = themeSlice.actions
export default themeSlice.reducer
