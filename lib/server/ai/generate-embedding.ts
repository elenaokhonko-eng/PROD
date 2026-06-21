import { getOpenAiApiKey } from "@/lib/server/ai/generate-json"
import { logger } from "@/lib/logger"

const log = logger.withContext({ module: "ai-generate-embedding" })

const EMBEDDING_MODEL = "text-embedding-3-small"

export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = getOpenAiApiKey()
  const input = text.trim()
  if (!input) {
    throw new Error("Embedding input text is required")
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
    }),
  })

  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`OpenAI embeddings failed (${response.status}): ${raw}`)
  }

  const parsed = JSON.parse(raw) as { data?: Array<{ embedding?: number[] }> }
  const embedding = parsed.data?.[0]?.embedding
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("OpenAI embeddings returned no embedding array")
  }

  log.info("Generated embedding", { model: EMBEDDING_MODEL, inputLength: input.length })
  return embedding
}
