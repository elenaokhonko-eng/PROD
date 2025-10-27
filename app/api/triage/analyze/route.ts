import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { rateLimit, keyFrom } from "@/lib/rate-limit"

const analyzeSchema = z.object({
  session_token: z.string().min(1, "session_token is required"),
  narrative: z.string().min(1, "narrative must not be empty").max(20_000).optional(),
  classification: z.record(z.any(), z.any()).optional(),
  responses: z.record(z.any(), z.any()).optional(),
})

// Compatibility endpoint that orchestrates classify -> questions -> assess
export async function POST(request: NextRequest) {
  try {
    const rl = rateLimit(keyFrom(request, "/api/triage/analyze"), 30, 60_000)
    if (!rl.ok) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
    }

    let parsed
    try {
      parsed = analyzeSchema.parse(await request.json())
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid request body", details: err.flatten() }, { status: 400 })
      }
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const { session_token, narrative, classification, responses } = parsed

    if (!classification && !narrative) {
      return NextResponse.json({ error: "Provide narrative or classification data" }, { status: 400 })
    }

    // If no classification and we have narrative, classify first
    if (!classification && narrative) {
      const res = await fetch(new URL("/api/router/classify", request.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token, narrative }),
      })
      if (!res.ok) return NextResponse.json({ error: "Classification failed" }, { status: res.status })
      const data = await res.json()
      return NextResponse.json({ step: "classified", classification: data })
    }

    // If we have classification but no responses, generate questions
    if (classification && !responses) {
      const res = await fetch(new URL("/api/router/questions", request.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token, classification }),
      })
      if (!res.ok) return NextResponse.json({ error: "Question generation failed" }, { status: res.status })
      const data = await res.json()
      return NextResponse.json({ step: "questions", ...data })
    }

    // If we have classification and responses, assess eligibility
    if (classification && responses) {
      const res = await fetch(new URL("/api/router/assess", request.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_token, classification, responses }),
      })
      if (!res.ok) return NextResponse.json({ error: "Assessment failed" }, { status: res.status })
      const data = await res.json()
      return NextResponse.json({ step: "assessment", assessment: data })
    }

    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  } catch (err) {
    console.error("/api/triage/analyze error:", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
