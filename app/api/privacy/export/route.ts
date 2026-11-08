import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { createUserClient } from "@/lib/supabase/server"
import { safeErrorText } from "@/lib/server/safe-error"

type IdRow = { id: string }

// What the user wrote and confirmed, and the facts extracted from it (fact reconciliation, migration 38).
const FACT_TABLES = [
  "case_story_revisions",
  "case_response_revisions",
  "case_fact_reconcile_runs",
  "case_fact_candidates",
  "case_fact_findings",
  "case_fact_snapshots",
  "case_fact_confirmation_events",
] as const

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
      console.error("[privacy] failed to load owned cases:", safeErrorText(ownedCasesError))
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

    const factsPromise = Promise.all(
      FACT_TABLES.map((table) =>
        ownedCaseIds.length > 0
          ? supabase.from(table).select("*").in("case_id", ownedCaseIds)
          : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
      ),
    )

    const [profileResult, casesResult, responsesResult, paymentsResult, outcomesResult, factResults] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.supabaseUuid).single(),
      supabase.from("cases").select("*").eq("user_id", user.supabaseUuid),
      responsesPromise,
      supabase.from("payments").select("*").eq("user_id", user.supabaseUuid),
      outcomesPromise,
      factsPromise,
    ])

    const failedQuery = [
      { label: "profile", error: profileResult.error },
      { label: "cases", error: casesResult.error },
      { label: "case responses", error: responsesResult.error },
      { label: "payments", error: paymentsResult.error },
      { label: "case outcomes", error: outcomesResult.error },
      ...FACT_TABLES.map((table, i) => ({ label: table, error: factResults[i].error })),
    ].find((result) => result.error)

    if (failedQuery) {
      console.error(`[privacy] failed to export ${failedQuery.label}:`, safeErrorText(failedQuery.error))
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
      ...Object.fromEntries(FACT_TABLES.map((table, i) => [table, factResults[i].data ?? []])),
    }

    return NextResponse.json(exportPayload)
  } catch (err) {
    console.error("[privacy] export error:", safeErrorText(err))
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 })
  }
}
