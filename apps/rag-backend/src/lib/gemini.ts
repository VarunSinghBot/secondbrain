import { embedText } from "./groq-embeddings"
import { generateGroqAnswer } from "./groq"

export async function createEmbedding(text: string): Promise<number[]> {
  return embedText(text)
}

export async function generateAnswer(prompt: string): Promise<string> {
  return generateGroqAnswer(prompt)
}