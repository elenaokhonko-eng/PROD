import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { rateLimit, keyFrom } from "@/lib/rate-limit"
import { determinePath } from "@/lib/rules"
import type { TriageSignals } from "@/lib/rules"

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

    const { classification } = parsed

    // Extract triage signals from classification_result stored by the classify route.
    // We cast conservatively — determinePath handles missing/null fields gracefully.
    const signals: TriageSignals = {
      money_lost: typeof classification.money_lost === "boolean" ? classification.money_lost : true,
      transaction_type: (classification.transaction_type as TriageSignals["transaction_type"]) ?? "unknown",
      scam_type: (classification.scam_type as TriageSignals["scam_type"]) ?? "unknown",
      scam_channel: (classification.scam_channel as TriageSignals["scam_channel"]) ?? null,
      entity_impersonation: typeof classification.entity_impersonation === "boolean"
        ? classification.entity_impersonation
        : null,
      fi_name: typeof classification.fi_name === "string" ? classification.fi_name : null,
      incident_date: typeof classification.incident_date === "string" ? classification.incident_date : null,
      bank_contacted: typeof classification.bank_contacted === "boolean" ? classification.bank_contacted : null,
      bank_contact_date: typeof classification.bank_contact_date === "string" ? classification.bank_contact_date : null,
      bank_final_reply: typeof classification.bank_final_reply === "boolean" ? classification.bank_final_reply : null,
      police_report_filed: typeof classification.police_report_filed === "boolean"
        ? classification.police_report_filed
        : null,
      claim_amount_sgd: typeof classification.claim_amount_sgd === "number" ? classification.claim_amount_sgd : null,
      summary: typeof classification.summary === "string" ? classification.summary : "",
      distress_signals: typeof classification.distress_signals === "boolean" ? classification.distress_signals : false,
    }

    const pathResult = determinePath(signals)

    // Return PathResult — fully backward compatible with what the results page expects.
    return NextResponse.json({
      ...pathResult,
      // Legacy field expected by the results page
      is_fidrec_eligible: pathResult.recommended_path === "fidrec_eligible",
    })
  } catch (error) {
    console.error("[assess] Error:", error)
    return NextResponse.json({ error: "Assessment failed" }, { status: 500 })
  }
}
