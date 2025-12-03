import { type NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai"
import { z } from "zod"
import { rateLimit, keyFrom } from "@/lib/rate-limit"

const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY
if (!API_KEY) {
  throw new Error("GOOGLE_GENERATIVE_AI_API_KEY environment variable not set.")
}

const genAI = new GoogleGenerativeAI(API_KEY)
// 2.5 Flash is available on v1beta for JSON output
const modelName = "models/gemini-2.5-flash"

function scrub<T>(obj: T): T {
  try {
    const json = JSON.stringify(obj)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
      .replace(/\b([STFG]\d{7}[A-Z])\b/gi, "[REDACTED_NRIC]")
      .replace(/\b(\+?65[- ]?)?\d{4}[- ]?\d{4}\b/g, "[REDACTED_PHONE]")
      .replace(/\b\d{12,16}\b/g, "[REDACTED_ACCOUNT]")
    return JSON.parse(json) as T
  } catch {
    return obj
  }
}

const questionRequestSchema = z.object({
  session_token: z.string().min(1, "session_token is required"),
  classification: z.record(z.string(), z.unknown()),
})

export async function POST(request: NextRequest) {
  try {
    const rl = rateLimit(keyFrom(request, "/api/router/questions"), 20, 60_000)
    if (!rl.ok) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })

    let parsed
    try {
      parsed = questionRequestSchema.parse(await request.json())
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid request body", details: err.flatten() }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const { session_token: sessionToken, classification } = parsed
    void sessionToken

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
      },
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
    })

    const prompt = `You are an intake assistant for GuideBuoy AI (Singapore consumer disputes and scam complaints). We no longer gate users for FIDReC—ask practical, lightweight questions that help us move them to the right path.

Based on this dispute classification:
${JSON.stringify(scrub(classification), null, 2)}

Generate 5-7 clarifying questions to understand the case. Focus on:
1. Who/what they dealt with (institution or party)
2. Rough claim amount or loss
3. When it happened
4. What they already tried (e.g., contacted institution/police)
5. Evidence availability (receipts, screenshots, reference numbers)
6. Urgency or harm (money lost, account access, harassment)

Return a JSON object with a "questions" array. Each question should have:
- key: unique identifier (snake_case)
- question: the question text
- type: "radio", "text", "number", or "date"
- options: array of options (for radio type)
- required: boolean

Keep wording plain and friendly. Do not include legal disclaimers.

JSON Output:`

    const result = await model.generateContent(prompt)
    const response = result.response
    const rawText =
      response.text() ??
      response.candidates?.[0]?.content?.parts?.find((part) => "text" in part)?.text ??
      ""

    let data: Record<string, unknown>
    try {
      data = JSON.parse(rawText) as Record<string, unknown>
    } catch (err) {
      console.error("[v0] Questions JSON parse error:", err, rawText)
      return NextResponse.json({ error: "Unable to parse generated questions" }, { status: 502 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Questions generation error:", error)
    if (
      typeof error === "object" &&
      error !== null &&
      "response" in error &&
      typeof (error as { response?: { data?: unknown } }).response === "object"
    ) {
      const responseData = (error as { response?: { data?: unknown } }).response?.data
      if (responseData) {
        console.error("API Error details:", JSON.stringify(responseData, null, 2))
      }
    }
    return NextResponse.json({ error: "Failed to generate questions" }, { status: 500 })
  }
}
