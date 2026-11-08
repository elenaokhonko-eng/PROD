import OpenAI from "openai"

import { logger } from "@/lib/logger"
import { safeErrorText } from "@/lib/server/safe-error"

const log = logger.withContext({ module: "ai-generate-json" })

export type GenerateJsonInput = {
  prompt: string
  schemaName: string
  /** Per-request limit; the client default is ten minutes. Interactive callers should set this. */
  timeoutMs?: number
  /** Client retries after a failed or timed-out request (client default 2). */
  maxRetries?: number
}

type ResponseLike = {
  output_text?: string | null
  output?: Array<{
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
}

const ZERO_WIDTH_CHAR_PATTERN = /[\u200B-\u200D\uFEFF\u2060]/g
const INLINE_WHITESPACE_PATTERN = /[\r\n\t]/g

export function sanitizeOpenAiApiKey(raw: string | undefined): string {
  if (!raw) return ""

  let value = raw.trim()

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim()
  }

  value = value.replace(ZERO_WIDTH_CHAR_PATTERN, "")
  value = value.replace(INLINE_WHITESPACE_PATTERN, "")

  return value.trim()
}

export function getOpenAiApiKey(): string {
  const apiKey = sanitizeOpenAiApiKey(process.env.OPENAI_API_KEY)
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable not set.")
  }
  return apiKey
}

export function getOpenAiModel(): string {
  // OpenAI model IDs are lower-case and case-sensitive ("GPT-4.1-mini" is a 404).
  return process.env.OPENAI_MODEL?.trim().toLowerCase() || "gpt-4.1-mini"
}

function extractResponseText(response: ResponseLike, schemaName: string): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim()
  }

  const fromOutput = (response.output ?? [])
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("")
    .trim()

  if (fromOutput) {
    return fromOutput
  }

  throw new Error(`OpenAI returned no output text for ${schemaName}`)
}

function normalizeJsonText(rawText: string): string {
  const trimmed = rawText.trim()
  if (!trimmed.startsWith("```")) return trimmed
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
}

export async function generateJson<T = unknown>(input: GenerateJsonInput): Promise<T> {
  const apiKey = getOpenAiApiKey()
  const { prompt, schemaName, timeoutMs, maxRetries } = input
  const client = new OpenAI({
    apiKey,
    ...(timeoutMs ? { timeout: timeoutMs } : {}),
    ...(maxRetries !== undefined ? { maxRetries } : {}),
  })
  const model = getOpenAiModel()

  log.info("Calling OpenAI for JSON output", { schemaName, model })

  let response: ResponseLike
  try {
    response = (await client.responses.create({
      model,
      input: prompt,
      text: {
        format: { type: "json_object" },
      },
    })) as ResponseLike
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`OpenAI request failed for ${schemaName}: ${message}`)
  }

  const rawText = extractResponseText(response, schemaName)

  try {
    return JSON.parse(normalizeJsonText(rawText)) as T
  } catch (error) {
    throw new Error(
      `Model output is not valid JSON for ${schemaName}: ${
        // A JSON.parse error quotes the model output it failed on (hardening item 6).
        safeErrorText(error)
      }`,
    )
  }
}
