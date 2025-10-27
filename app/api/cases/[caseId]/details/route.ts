import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

const updateCaseSchema = z
  .object({
    claim_amount: z.coerce.number().min(0).nullable().optional(),
    institution_name: z.string().max(255).nullable().optional(),
    incident_date: z.string().max(32).nullable().optional(),
    case_summary: z.string().max(5000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "No updatable fields provided" })
    }
  })

export async function GET(_request: NextRequest, { params }: { params: { caseId: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabase
    .from("cases")
    .select("id, claim_type, status, claim_amount, institution_name, incident_date, case_summary")
    .eq("id", params.caseId)
    .single()
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(data)
}

export async function PUT(request: NextRequest, { params }: { params: { caseId: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let allowed
  try {
    allowed = updateCaseSchema.parse(await request.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request body", details: err.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("cases")
    .update({ ...allowed, updated_at: new Date().toISOString() })
    .eq("id", params.caseId)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
