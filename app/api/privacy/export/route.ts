import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { createUserClient } from "@/lib/supabase/server"

type IdRow = { id: string }

export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = await createUserClient()

    const { data: ownedCases, error: ownedCasesError } = await supabase
      .from("cases")
      .select("id")
      .eq("user_id", user.supabaseUuid)

    if (ownedCasesError) {
      console.error("[privacy] failed to load owned cases:", ownedCasesError)
      return NextResponse.json({ error: "Failed to export data" }, { status: 500 })
    }

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
      supabase.from("profiles").select("*").eq("id", user.supabaseUuid).single(),
      supabase.from("cases").select("*").eq("user_id", user.supabaseUuid),
      responsesPromise,
      supabase.from("payments").select("*").eq("user_id", user.supabaseUuid),
      outcomesPromise,
    ])

    const failedQuery = [
      { label: "profile", error: profileResult.error },
      { label: "cases", error: casesResult.error },
      { label: "case responses", error: responsesResult.error },
      { label: "payments", error: paymentsResult.error },
      { label: "case outcomes", error: outcomesResult.error },
    ].find((result) => result.error)

    if (failedQuery) {
      console.error(`[privacy] failed to export ${failedQuery.label}:`, failedQuery.error)
      return NextResponse.json({ error: "Failed to export data" }, { status: 500 })
    }

    const profile = profileResult.data ?? null
    const cases = casesResult.data ?? []
    const responses = responsesResult.data ?? []
    const payments = paymentsResult.data ?? []
    const outcomes = outcomesResult.data ?? []

    const exportPayload = {
      generated_at: new Date().toISOString(),
      user: { id: user.supabaseUuid, email: profile?.email ?? null },
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
