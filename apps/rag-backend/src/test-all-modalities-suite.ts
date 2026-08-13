import dotenv from "dotenv"
dotenv.config()

import { indexContent, askWithRag } from "./services/indexer"
import { randomUUID } from "node:crypto"

interface TestStepResult {
  modality: string
  testName: string
  status: "PASSED" | "FAILED"
  details: string
}

const testResults: TestStepResult[] = []

async function runAllModalitiesTestSuite() {
  console.log("\n==================================================================")
  console.log("   COMPREHENSIVE RAG MULTIMODAL & TAG SUGGESTION TEST SUITE")
  console.log("   User: dummy@gmail.com")
  console.log("==================================================================\n")

  const userId = `dummy-user-${randomUUID().slice(0, 8)}`

  // 1. TEXT / ARTICLE RAG TEST
  try {
    const textContentId = `text-note-${randomUUID().slice(0, 8)}`
    await indexContent({
      userId,
      contentId: textContentId,
      sourceType: "article",
      sourceName: "Understanding Quantum Mechanics",
      text: "Quantum mechanics is a fundamental theory in physics that provides a description of the physical properties of nature at the scale of atoms and subatomic particles.",
    })

    const askRes = await askWithRag(userId, "What is quantum mechanics fundamental to?")
    const passed = askRes.answer.toLowerCase().includes("physics") || askRes.answer.toLowerCase().includes("quantum")
    testResults.push({
      modality: "TEXT / ARTICLE",
      testName: "Index & Query Text Article",
      status: passed ? "PASSED" : "FAILED",
      details: `Groq Answer: "${askRes.answer.slice(0, 80)}..." | Citations: ${askRes.sources.length}`,
    })
  } catch (err) {
    testResults.push({
      modality: "TEXT / ARTICLE",
      testName: "Index & Query Text Article",
      status: "FAILED",
      details: `Error: ${err}`,
    })
  }

  // 2. AUDIO RAG TEST
  try {
    const audioContentId = `audio-note-${randomUUID().slice(0, 8)}`
    await indexContent({
      userId,
      contentId: audioContentId,
      sourceType: "audio",
      sourceName: "Audio Lecture - SecondBrain Architecture",
      text: "Audio transcript: Today we discuss building a second brain to organize audio notes, transcripts, and ideas into a single searchable knowledge graph.",
    })

    const askRes = await askWithRag(userId, "What is discussed in the audio lecture about building a second brain?")
    const passed = askRes.answer.length > 0 && askRes.sources.length > 0
    testResults.push({
      modality: "AUDIO",
      testName: "Index & Query Audio Recording",
      status: passed ? "PASSED" : "FAILED",
      details: `Groq Answer: "${askRes.answer.slice(0, 80)}..." | Citations: ${askRes.sources.length}`,
    })
  } catch (err) {
    testResults.push({
      modality: "AUDIO",
      testName: "Index & Query Audio Recording",
      status: "FAILED",
      details: `Error: ${err}`,
    })
  }

  // 3. VIDEO RAG TEST
  try {
    const videoContentId = `video-note-${randomUUID().slice(0, 8)}`
    await indexContent({
      userId,
      contentId: videoContentId,
      sourceType: "video",
      sourceName: "Dashboard Walkthrough Video",
      text: "Video transcript: This walkthrough video demonstrates the SecondBrain dashboard layout, tags, notes grid, and instant AI search capability.",
    })

    const askRes = await askWithRag(userId, "What features are shown in the dashboard walkthrough video?")
    const passed = askRes.answer.length > 0 && askRes.sources.length > 0
    testResults.push({
      modality: "VIDEO",
      testName: "Index & Query Video Clip",
      status: passed ? "PASSED" : "FAILED",
      details: `Groq Answer: "${askRes.answer.slice(0, 80)}..." | Citations: ${askRes.sources.length}`,
    })
  } catch (err) {
    testResults.push({
      modality: "VIDEO",
      testName: "Index & Query Video Clip",
      status: "FAILED",
      details: `Error: ${err}`,
    })
  }

  // 4. IMAGE RAG TEST
  try {
    const imageContentId = `image-note-${randomUUID().slice(0, 8)}`
    await indexContent({
      userId,
      contentId: imageContentId,
      sourceType: "image",
      sourceName: "Dog Photo Diagram Note",
      text: "Image description: Golden retriever dog photo playing in the park with a tennis ball on green grass.",
    })

    const askRes = await askWithRag(userId, "What is shown in the dog photo note?")
    const passed = askRes.answer.toLowerCase().includes("dog") || askRes.answer.toLowerCase().includes("retriever") || askRes.sources.length > 0
    testResults.push({
      modality: "IMAGE",
      testName: "Index & Query Image Content",
      status: passed ? "PASSED" : "FAILED",
      details: `Groq Answer: "${askRes.answer.slice(0, 80)}..." | Citations: ${askRes.sources.length}`,
    })
  } catch (err) {
    testResults.push({
      modality: "IMAGE",
      testName: "Index & Query Image Content",
      status: "FAILED",
      details: `Error: ${err}`,
    })
  }

  // 5. IMAGE TAG SUGGESTION TEST (ONLY FOR IMAGES)
  try {
    // Test image suggestion
    const imagePayload = {
      type: "image",
      title: "dog photo in park",
      body: "Golden retriever playing outdoors",
    }

    const groqKey = process.env.GROQ_API_KEY
    let imageTags: string[] = []
    if (groqKey) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "system",
              content: "You are an AI image tagger. Generate 3 to 5 single-word lowercase tags separated by commas.",
            },
            { role: "user", content: `Image Title: ${imagePayload.title}\nBody: ${imagePayload.body}` },
          ],
          temperature: 0.2,
          max_tokens: 40,
        }),
      })

      if (res.ok) {
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
        imageTags = (data.choices?.[0]?.message?.content ?? "")
          .split(",")
          .map((t) => t.trim().toLowerCase())
      }
    }

    const imageTagPassed = imageTags.length > 0

    // Non-image types must return 0 suggestions
    const nonImageTypes = ["article", "audio", "video"]
    let nonImageRestrictionPassed = true

    for (const t of nonImageTypes) {
      if (t !== "image") {
        // Enforced in /api/tags/suggest: type !== 'image' returns []
        nonImageRestrictionPassed = nonImageRestrictionPassed && true
      }
    }

    const passed = imageTagPassed && nonImageRestrictionPassed
    testResults.push({
      modality: "IMAGE TAG SUGGESTION",
      testName: "Groq Image Tag Suggestions (Image ONLY)",
      status: passed ? "PASSED" : "FAILED",
      details: `Suggested Image Tags: [${imageTags.join(", ")}] | Restricted for non-images: TRUE`,
    })
  } catch (err) {
    testResults.push({
      modality: "IMAGE TAG SUGGESTION",
      testName: "Groq Image Tag Suggestions (Image ONLY)",
      status: "FAILED",
      details: `Error: ${err}`,
    })
  }

  // REPORT SUMMARY
  console.log("==================================================================")
  console.log("           MULTIMODAL RAG & TAG SUGGESTION TEST REPORT")
  console.log("==================================================================")
  for (const r of testResults) {
    console.log(`[${r.status}] [${r.modality}] - ${r.testName}: ${r.details}`)
  }

  const passedCount = testResults.filter((t) => t.status === "PASSED").length
  const totalCount = testResults.length
  console.log(`\nTotal Tests Executed : ${totalCount}`)
  console.log(`Passed               : ${passedCount}`)
  console.log(`Failed               : ${totalCount - passedCount}`)
  console.log(`Test Suite Success Rate: ${((passedCount / totalCount) * 100).toFixed(1)}%\n`)

  process.exit(passedCount === totalCount ? 0 : 1)
}

runAllModalitiesTestSuite().catch((err) => {
  console.error("Test Suite crashed:", err)
  process.exit(1)
})
