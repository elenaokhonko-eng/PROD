import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import OpenAI from "openai"

import "./load-local-env.ts"

import { generateJson, getOpenAiApiKey } from "../lib/server/ai/generate-json.ts"

function readOpenAiKeyFromEnvLocal(): string | undefined {
  try {
    const content = readFileSync(resolve(process.cwd(), ".env.local"), "utf8")
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const match = trimmed.match(/^OPENAI_API_KEY=(.*)$/)
      if (match) return match[1]
    }
  } catch {
    return undefined
  }
  return undefined
}

function charCodes(label: string, value: string) {
  const codes = [...value].map((char) => char.charCodeAt(0))
  console.log(`${label}: [${codes.join(", ")}]`)
}

function printKeyDiagnostics() {
  const raw = process.env.OPENAI_API_KEY
  const fromFile = readOpenAiKeyFromEnvLocal()

  console.log("Key diagnostics (partial, safe):")
  console.log(`1. prefix JSON (process.env): ${JSON.stringify(raw?.slice(0, 12))}`)
  console.log(`2. suffix JSON (process.env): ${JSON.stringify(raw?.slice(-12))}`)
  console.log(`3. raw length: ${raw?.length ?? 0}`)
  console.log(`4. trimmed length: ${raw?.trim().length ?? 0}`)
  charCodes("5. last 5 char codes (raw process.env)", raw?.slice(-5) ?? "")
  charCodes("6. first 5 char codes (raw process.env)", raw?.slice(0, 5) ?? "")
  console.log(`7. prefix JSON (.env.local file): ${JSON.stringify(fromFile?.slice(0, 12))}`)
  console.log(`8. suffix JSON (.env.local file): ${JSON.stringify(fromFile?.slice(-12))}`)
  console.log(`9. process.env matches .env.local raw: ${fromFile === raw ? "yes" : "no"}`)
  console.log("")
}

async function main() {
  printKeyDiagnostics()

  const apiKey = getOpenAiApiKey()
  const client = new OpenAI({ apiKey })

  console.log("SDK models.list (sanitized key)...")
  try {
    const models = await client.models.list()
    console.log(`models.list: ok (${models.data.length} models)`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`models.list: failed — ${message}`)
  }

  console.log("")
  console.log("generateJson / responses.create (sanitized key)...")

  const result = await generateJson({
    prompt: 'Return JSON only: {"ok": true, "message": "hello"}',
    schemaName: "openai json smoke test",
  })

  console.log("Parsed result:")
  console.log(JSON.stringify(result, null, 2))
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error("\nOpenAI JSON smoke test failed:")
  console.error(message)
  process.exit(1)
})
