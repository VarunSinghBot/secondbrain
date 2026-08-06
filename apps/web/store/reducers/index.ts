import { combineReducers } from "@reduxjs/toolkit"
import themeReducer from "./themeSlice"

const rootReducer = combineReducers({
  theme: themeReducer,
})

export default rootReducer
