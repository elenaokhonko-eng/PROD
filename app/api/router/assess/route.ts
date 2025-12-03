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

    const prompt = `You are an intake assistant for GuideBuoy AI (Singapore consumer disputes and scam complaints). Do NOT gate users behind strict FIDReC criteria—we want everyone to keep moving, with a recommended path that fits what they shared.

Context to consider (not blockers): institution type, claim size, timing, whether they already contacted the institution, and what evidence they have. Use this to choose a helpful path, not to reject.

Dispute Classification:
${JSON.stringify(scrub(classification), null, 2)}

User Responses:
${JSON.stringify(scrub(responses), null, 2)}

Decide the best support path and provide:
1. is_fidrec_eligible: boolean (true when a formal escalation or ombuds-style path seems viable; otherwise false)
2. eligibility_score: 0-100 (overall confidence in the case/story strength for any path)
3. recommended_path: one of
   - "fidrec_eligible": move ahead with a hands-on case build / escalation
   - "waitlist": we need to loop them into our launch or specialist queue
   - "self_service": give DIY guidance/resources now
   - "not_eligible": only for clearly out-of-scope or abusive content; prefer self_service otherwise
4. reasoning: Array of key points explaining the assessment
5. missing_info: Array of any critical missing information
6. next_steps: Array of 3-5 recommended actions the user can take now
7. estimated_timeline: String describing expected timeline
8. success_probability: "high" | "medium" | "low"

Be generous: never block the user just because details are missing; still pick the best available path and surface missing_info.

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
