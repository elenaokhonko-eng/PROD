import { NextResponse } from "next/server"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth"
import { createUserClient } from "@/lib/supabase/server"

const sensoryModeSchema = z.object({
  mode: z.enum(["steady", "quiet", "grounding"]),
})

export async function GET() {
  const currentUser = await getCurrentUser()
  if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createUserClient()
  const { data, error } = await supabase
    .from("profiles")
    .select("sensory_mode")
    .eq("id", currentUser.supabaseUuid)
    .single()

  if (error) {
    return NextResponse.json({ error: "Unable to load display preference" }, { status: 500 })
  }

  return NextResponse.json({ mode: data.sensory_mode ?? "steady" })
}

export async function PUT(request: Request) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsed = sensoryModeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid display preference" }, { status: 400 })
  }

  const supabase = await createUserClient()
  const { data, error } = await supabase
    .from("profiles")
    .update({ sensory_mode: parsed.data.mode, updated_at: new Date().toISOString() })
    .eq("id", currentUser.supabaseUuid)
    .select("sensory_mode")
    .single()

  if (error || !data) {
    return NextResponse.json({ error: "Unable to save display preference" }, { status: 500 })
  }

  return NextResponse.json({ mode: data.sensory_mode })
}
