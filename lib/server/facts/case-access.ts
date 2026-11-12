import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/auth"
import { createUserClient } from "@/lib/supabase/server"

export interface FactsCaseAccess {
  profileId: string
  isOwner: boolean
}

// The user's own client proves they may view the case (RLS); only the owner may resolve findings or freeze facts.
export async function factsCaseAccess(caseId: string): Promise<FactsCaseAccess | NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createUserClient()
  const { data, error } = await supabase.from("cases").select("id, user_id").eq("id", caseId).maybeSingle()
  if (error) return NextResponse.json({ error: "Failed to load case" }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Case not found" }, { status: 404 })

  return { profileId: user.supabaseUuid, isOwner: data.user_id === user.supabaseUuid }
}
