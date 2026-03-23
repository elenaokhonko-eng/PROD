import { NextResponse } from "next/server"
import { getOrCreateProfile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

type IdRow = { id: string }

export async function POST() {
  try {
    const user = await getOrCreateProfile()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = await createClient()

    const { data: ownedCases } = await supabase.from("cases").select("id").eq("user_id", user.profileId)
    const ownedCaseIds = (ownedCases ?? []).map((row: IdRow) => row.id)

    // Pull primary user data
    const responsesPromise =
      ownedCaseIds.length > 0
        ? supabase.from("case_responses").select("*").in("case_id", ownedCaseIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[], error: null })

    const outcomesPromise =
      ownedCaseIds.length > 0
        ? supabase.from("case_outcomes").select("*").in("case_id", ownedCaseIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[], error: null })

    const [profileResult, casesResult, responsesResult, paymentsResult, outcomesResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.profileId).single(),
      supabase.from("cases").select("*").eq("user_id", user.profileId),
      responsesPromise,
      supabase.from("payments").select("*").eq("user_id", user.profileId),
      outcomesPromise,
    ])

    const profile = profileResult.data ?? null
    const cases = casesResult.data ?? []
    const responses = responsesResult.data ?? []
    const payments = paymentsResult.data ?? []
    const outcomes = outcomesResult.data ?? []

    const exportPayload = {
      generated_at: new Date().toISOString(),
      user: { id: user.profileId, email: user.email },
      profile,
      cases,
      case_responses: responses,
      payments,
      case_outcomes: outcomes,
    }

    return NextResponse.json(exportPayload)
  } catch (err) {
    console.error("[privacy] export error:", err)
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 })
  }
}
