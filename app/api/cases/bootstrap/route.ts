import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { createUserClient } from '@/lib/supabase/server'

const BootstrapBody = z.object({
  narrative: z.string().min(1).max(20000),
  transcript: z.string().max(20000).optional(),
  claim_type: z.string().optional(),
  title: z.string().max(200).optional(),
})

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const parsed = BootstrapBody.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 })
  }
  const { narrative, transcript, claim_type } = parsed.data

  // User-scoped Supabase client (RLS enforces auth.uid() == cases.user_id).
  const supabase = await createUserClient()

  const { data: caseRow, error: caseErr } = await supabase
    .from('cases')
    .insert({
      claim_type: claim_type ?? 'phishing_scam',
      user_id: user.supabaseUuid,
      primary_narrative: narrative,
    })
    .select('id')
    .single()

  if (caseErr || !caseRow) {
    return NextResponse.json({ error: 'case_insert_failed', details: caseErr?.message }, { status: 500 })
  }

  const { error: intakeErr } = await supabase
    .from('case_intake')
    .insert({
      case_id: caseRow.id,
      intake_type: 'initial',
      narrative_text: narrative,
      source: transcript ? 'voice' : 'text',
    })

  if (intakeErr) {
    return NextResponse.json({ error: 'intake_insert_failed', details: intakeErr.message }, { status: 500 })
  }

  return NextResponse.json({ case_id: caseRow.id }, { status: 201 })
}
