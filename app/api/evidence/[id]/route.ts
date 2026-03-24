import { NextResponse, type NextRequest } from "next/server"
import { getOrCreateProfile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getOrCreateProfile()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const supabase = await createClient()

  const { error } = await supabase.from("evidence").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
