import { type NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai"
import { z } from "zod"
import { rateLimit, keyFrom } from "@/lib/rate-limit"

const API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY
if (!API_KEY) {
  throw new Error("GOOGLE_GENERATIVE_AI_API_KEY environment variable not set.")
}

const genAI = new GoogleGenerativeAI(API_KEY)
const modelName = "models/gemini-3.0-pro-latest"

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

const assessSchema = z.object({
  session_token: z.string().min(1, "session_token is required"),
  classification: z.record(z.string(), z.unknown()),
  responses: z.record(z.string(), z.unknown()),
})

export async function POST(request: NextRequest) {
  try {
    const rl = rateLimit(keyFrom(request, "/api/router/assess"), 20, 60_000)
    if (!rl.ok) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })

    let parsed
    try {
      parsed = assessSchema.parse(await request.json())
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid request body", details: err.flatten() }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const { session_token: sessionToken, classification, responses } = parsed
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

    const prompt = `You are an expert in Singapore FIDReC (Financial Industry Disputes Resolution Centre) eligibility criteria.

FIDReC Eligibility Requirements:
1. Must be an individual consumer (not business)
2. Dispute must be with a Singapore financial institution (FIDReC member)
3. Claim amount must be <= SGD 150,000
4. Incident must have occurred within last 6 years
5. Must have first complained to the institution
6. Institution must have rejected or not resolved within 30 days

Dispute Classification:
${JSON.stringify(scrub(classification), null, 2)}

User Responses:
${JSON.stringify(scrub(responses), null, 2)}

Assess eligibility and provide:
1. is_fidrec_eligible: boolean
2. eligibility_score: 0-100 (confidence in case strength)
3. recommended_path: "fidrec_eligible" | "waitlist" | "self_service" | "not_eligible"
4. reasoning: Array of key points explaining the assessment
5. missing_info: Array of any critical missing information
6. next_steps: Array of 3-5 recommended actions
7. estimated_timeline: String describing expected timeline
8. success_probability: "high" | "medium" | "low"

Return ONLY valid JSON, no other text.

JSON Output:`

    const result = await model.generateContent(prompt)
    const response = result.response
    const rawText =
      response.text() ??
      response.candidates?.[0]?.content?.parts?.find((part) => "text" in part)?.text ??
      ""

    let assessment: Record<string, unknown>
    try {
      assessment = JSON.parse(rawText) as Record<string, unknown>
    } catch (err) {
      console.error("[v0] Assessment JSON parse error:", err, rawText)
      return NextResponse.json({ error: "Unable to parse assessment result" }, { status: 502 })
    }

    return NextResponse.json(assessment)
  } catch (error) {
    console.error("[v0] Assessment error:", error)
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
    return NextResponse.json({ error: "Assessment failed" }, { status: 500 })
  }
}
