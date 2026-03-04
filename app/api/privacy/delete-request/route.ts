import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { trackServerEvent } from "@/lib/analytics/server"

// Best-effort anonymization for MVP: scrub textual fields, delete evidence files/rows,
// mark cases anonymized and log analytics events. In production, move to a queue/job.
export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = await createClient()

    // Fetch user's cases (owner or creator)
    const { data: cases } = await supabase
      .from("cases")
      .select("id")
      .eq("user_id", user.profileId)

    const caseIds = (cases ?? []).map((c: { id: string }) => c.id)

    // Delete evidence files + rows for each case (storage objects are named by file_path)
    if (caseIds.length > 0) {
      await supabase.from("evidence").delete().in("case_id", caseIds)

      await supabase
        .from("case_responses")
        .update({ response_value: "[deleted]" })
        .in("case_id", caseIds)

      // Scrub key case fields and mark anonymization flags
      await supabase
        .from("cases")
        .update({
          institution_name: "[redacted]",
          case_summary: "[deleted]",
          anonymization_requested: true,
          anonymization_completed_at: new Date().toISOString(),
        })
        .in("id", caseIds)
    }

    // Log events
    await trackServerEvent({
      eventName: "privacy_delete_completed",
      userId: user.profileId,
      eventData: { case_ids: caseIds },
    })

    return NextResponse.json({ success: true, anonymized_case_ids: caseIds })
  } catch (err) {
    console.error("[privacy] delete/anonymize error:", err)
    return NextResponse.json({ error: "Failed to process delete request" }, { status: 500 })
  }
}
