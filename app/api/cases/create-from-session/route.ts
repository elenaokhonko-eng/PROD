import { NextResponse } from "next/server"

import { trackServerEvent } from "@/lib/analytics/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { token } = await request.json()
  if (!token) {
    return NextResponse.json({ error: "Session token is required" }, { status: 400 })
  }

  const supabaseService = createServiceClient()

  const { data: routerSession, error: sessionError } = await supabaseService
    .from("router_sessions")
    .select("*")
    .eq("session_token", token)
    .eq("converted_to_user_id", user.id)
    .eq("status", "CONVERTED")
    .maybeSingle()

  if (sessionError) {
    console.error(`[Create Case] Error fetching router session ${token} for user ${user.id}:`, sessionError)
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  if (!routerSession) {
    console.warn(`[Create Case] No convertible session found for token ${token} and user ${user.id}`)
    return NextResponse.json({ error: "No convertible session found" }, { status: 404 })
  }

  const { data: newCase, error: caseError } = await supabaseService
    .from("cases")
    .insert({
      user_id: user.id,
      case_status: "DRAFT",
      claim_type: routerSession.classification_result?.claimType || "Phishing Scam",
      dispute_narrative: routerSession.dispute_narrative,
    })
    .select("id")
    .single()

  if (caseError) {
    console.error(`[Create Case] Error creating new case for user ${user.id}:`, caseError)
    return NextResponse.json({ error: "Failed to create case" }, { status: 500 })
  }

  const { error: updateError } = await supabaseService
    .from("router_sessions")
    .update({
      status: "IMPORTED",
      converted_to_case_id: newCase.id,
    })
    .eq("id", routerSession.id)

  if (updateError) {
    console.warn(`[Create Case] Failed to mark session ${routerSession.id} as imported:`, updateError)
  }

  trackServerEvent({
    eventName: "router_conversion_imported",
    userId: user.id,
    sessionId: routerSession.session_token,
    eventData: {
      case_id: newCase.id,
      recommended_path: routerSession.recommended_path,
    },
  })

  return NextResponse.json({
    success: true,
    caseId: newCase.id,
    message: "Case created from session",
  })
}
