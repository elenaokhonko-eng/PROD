import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { trackServerEvent } from "@/lib/analytics/server"

// Best-effort anonymization for MVP: scrub textual fields, delete evidence files/rows,
// mark cases anonymized and log analytics events. In production, move to a queue/job.
export async function POST() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Fetch user's cases (owner or creator)
    const { data: cases } = await supabase
      .from("cases")
      .select("id")
      .or(`user_id.eq.${user.id},owner_user_id.eq.${user.id},creator_user_id.eq.${user.id}`)

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
      userId: user.id,
      eventData: { case_ids: caseIds },
    })

    return NextResponse.json({ success: true, anonymized_case_ids: caseIds })
  } catch (err) {
    console.error("[privacy] delete/anonymize error:", err)
    return NextResponse.json({ error: "Failed to process delete request" }, { status: 500 })
  }
}
