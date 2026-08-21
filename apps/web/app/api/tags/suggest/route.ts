import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

// Live-measured: a real request through this route once took 75.8s end to
// end with no bound on either fetch — from the user's side that's
// indistinguishable from "broken." Each external hop gets its own timeout
// so a slow image host or a busy OCR.space (this uses their shared public
// demo key, "K85658722688957", when OCR_SPACE_API_KEY isn't set — heavily
// used, so it's a plausible slow point) degrades to "no OCR text" instead
// of hanging the whole suggestion.
const FETCH_TIMEOUT_MS = 8000

async function extractTextFromImage(imageUrl: string): Promise<string> {
  try {
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!imgRes.ok) return ""
    const arrayBuf = await imgRes.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)

    const apiKey = process.env.OCR_SPACE_API_KEY || "K85658722688957"
    const formData = new FormData()
    formData.append("apikey", apiKey)
    formData.append("language", "eng")
    formData.append("isOverlayRequired", "false")
    formData.append("file", new Blob([buffer]), "image.png")

    const ocrRes = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!ocrRes.ok) return ""
    const data = (await ocrRes.json()) as { ParsedResults?: Array<{ ParsedText?: string }> }
    return data.ParsedResults?.[0]?.ParsedText?.trim() ?? ""
  } catch (err) {
    console.warn("OCR Tag extraction warning (treating as no text found):", err)
    return ""
  }
}

async function generateTagsWithGroq(imageText: string, title?: string, imageUrl?: string): Promise<string[]> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) return []

  const fileName = imageUrl ? imageUrl.split("/").pop()?.split("?")[0] : ""
  const userPrompt = `Image File: ${fileName}\nNote Title: ${title ?? ""}\nExtracted Image OCR Text:\n${imageText || "No text detected in image."}`

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // llama-3.3-70b-versatile was retired from Groq's API (404s on every
        // call) — see rag-backend's e882215 fix, which swapped its own
        // hardcoded references to this same model.
        model: "openai/gpt-oss-120b",
        // gpt-oss-120b is a reasoning model — without this, its hidden
        // chain-of-thought eats the whole max_tokens budget before it ever
        // emits the actual tag list, leaving `content` empty (confirmed live:
        // finish_reason "length", content "" at max_tokens=60 without this).
        // "low" is enough reasoning for a 3-5 word tag list.
        reasoning_effort: "low",
        messages: [
          {
            role: "system",
            content: "You are an intelligent visual content tagger. Analyze the provided image filename, title, and OCR extracted text. Return ONLY 3 to 5 relevant single-word lowercase tags separated by commas. Example: dog, pet, animal, photo, canine",
          },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 60,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!res.ok) return []
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const rawTags = data.choices?.[0]?.message?.content ?? ""
    return rawTags
      .split(",")
      .map((t) => t.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase().trim())
      .filter((t) => t.length > 1)
  } catch (err) {
    console.warn("Groq Tag generation warning:", err)
    return []
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { imageUrl, title, body, type } = (await req.json().catch(() => ({}))) as {
      imageUrl?: string
      title?: string
      body?: string
      type?: string
    }

    // STRICT REQUIREMENT: Image tag suggestions ONLY for images
    if (type !== "image") {
      return NextResponse.json({ suggestions: [] })
    }

    const suggestionsSet = new Set<string>()
    suggestionsSet.add("image")

    let extractedText = ""
    if (imageUrl) {
      extractedText = await extractTextFromImage(imageUrl)
    }

    // Process image text & visual metadata with Groq LLaMA-3
    const aiTags = await generateTagsWithGroq(extractedText, title, imageUrl)
    for (const tag of aiTags) {
      suggestionsSet.add(tag)
    }

    // Additional keyword fallbacks from title, body, & filename
    const combinedInfo = `${imageUrl ?? ""} ${title ?? ""} ${body ?? ""} ${extractedText}`.toLowerCase()
    if (combinedInfo.includes("dog")) suggestionsSet.add("dog")
    if (combinedInfo.includes("cat")) suggestionsSet.add("cat")
    if (combinedInfo.includes("picture") || combinedInfo.includes("photo")) suggestionsSet.add("picture")
    if (combinedInfo.includes("project")) suggestionsSet.add("project")
    if (combinedInfo.includes("design")) suggestionsSet.add("design")
    if (combinedInfo.includes("diagram")) suggestionsSet.add("diagram")
    if (combinedInfo.includes("art")) suggestionsSet.add("art")

    if (suggestionsSet.size <= 1) {
      suggestionsSet.add("picture")
      suggestionsSet.add("photo")
    }

    const suggestions = Array.from(suggestionsSet).slice(0, 6)
    return NextResponse.json({ suggestions })
  } catch (e: unknown) {
    console.error("[POST /api/tags/suggest] Error:", e)
    return NextResponse.json({ suggestions: ["image", "picture", "photo"] })
  }
}
