import { NextResponse, type NextRequest } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { createUserClient } from "@/lib/supabase/server"

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const supabase = await createUserClient()

  const { data: deletedEvidence, error } = await supabase
    .from("evidence")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!deletedEvidence) return NextResponse.json({ error: "Evidence not found" }, { status: 404 })
  return NextResponse.json({ success: true })
}
