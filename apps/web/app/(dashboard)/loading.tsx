// Save as: app/(dashboard)/loading.tsx
// Next.js's App Router auto-detects this filename and renders it while
// this route segment's data is resolving — no manual wiring needed.
// Copy the same pattern into app/(auth)/loading.tsx, app/settings/loading.tsx,
// app/note/[id]/loading.tsx, etc. with a label that fits each page.

import LoadingScreen from "@/components/LoadingScreen"

export default function Loading() {
  return <LoadingScreen label="Loading your dashboard..." />
}