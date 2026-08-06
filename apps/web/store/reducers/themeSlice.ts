import { createSlice, type PayloadAction } from "@reduxjs/toolkit"

type Theme  = "light" | "dark" | "sepia" | "ocean"
type Layout = "compact" | "comfortable" | "spacious"

interface ThemeState { theme: Theme; layout: Layout }

const initialState: ThemeState = {
  theme:  (typeof window !== "undefined" ? (localStorage.getItem("sb_theme") as Theme)  : null) ?? "light",
  layout: (typeof window !== "undefined" ? (localStorage.getItem("sb_layout") as Layout) : null) ?? "comfortable",
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
  },
})

export const { setTheme, setLayout } = themeSlice.actions
export default themeSlice.reducer
