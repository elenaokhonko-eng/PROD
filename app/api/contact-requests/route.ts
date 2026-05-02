import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { createUserClient } from '@/lib/supabase/server'
import { ADMIN_EMAIL, EMAIL_FROM } from '@/lib/email-config'
import { sendMail } from '@/lib/mail'

const Body = z.object({
  case_id: z.string().uuid(),
  first_name: z.string().min(1).max(120),
  last_name: z.string().min(1).max(120),
  email: z.string().email(),
  phone: z.string().min(6).max(32),
  age: z.number().int().min(13).max(120),
  employment_status: z.enum(['professional', 'retiree', 'student', 'other']),
  thirty_days_since_last_fi_reply: z.boolean(),
  fi_issued_final_response: z.boolean(),
  message: z.string().max(500).optional(),
})

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

  const supabase = await createUserClient()

  const { data: snapshot, error: snapshotErr } = await supabase
    .from('cases')
    .select(
      `
      id,
      institution_name,
      claim_amount,
      latest_extract:case_extract_runs(extract_json, created_at)
    `,
    )
    .eq('id', body.case_id)
    .order('created_at', { referencedTable: 'case_extract_runs', ascending: false })
    .limit(1, { referencedTable: 'case_extract_runs' })
    .maybeSingle()

  if (snapshotErr) {
    return NextResponse.json({ error: snapshotErr.message }, { status: 500 })
  }
  if (!snapshot) {
    return NextResponse.json({ error: 'case_not_found' }, { status: 404 })
  }

  const extract = (snapshot.latest_extract?.[0]?.extract_json ?? null) as
    | { losses?: { reported_loss?: { amount?: number | null } }; case_meta?: { institution_name?: string | null } }
    | null

  const amountLostSgd = extract?.losses?.reported_loss?.amount ?? snapshot.claim_amount ?? null
  const financialInstitution = extract?.case_meta?.institution_name ?? snapshot.institution_name ?? null

  const { data: row, error: insertErr } = await supabase
    .from('escalation_waitlist')
    .upsert(
      {
        case_id: body.case_id,
        first_name: body.first_name,
        last_name: body.last_name,
        email: body.email,
        phone: body.phone,
        age: body.age,
        employment_status: body.employment_status,
        thirty_days_since_last_fi_reply: body.thirty_days_since_last_fi_reply,
        fi_issued_final_response: body.fi_issued_final_response,
        message: body.message ?? null,
        amount_lost_sgd: amountLostSgd,
        financial_institution: financialInstitution,
      },
      { onConflict: 'user_id,case_id' },
    )
    .select('id')
    .single()

  if (insertErr) {
    const status = insertErr.code === '42501' ? 403 : 500
    return NextResponse.json({ error: insertErr.message }, { status })
  }

  void sendMail({
    from: EMAIL_FROM,
    to: ADMIN_EMAIL,
    subject: 'New Layer 3 / Tier 2 contact request',
    html: `
      <h2>New contact request</h2>
      <p><strong>ID:</strong> ${row.id}</p>
      <p><strong>Case:</strong> ${body.case_id}</p>
      <p><strong>Name:</strong> ${body.first_name} ${body.last_name}</p>
      <p><strong>Email:</strong> ${body.email}</p>
      <p><strong>Phone:</strong> ${body.phone}</p>
      <p><strong>Age:</strong> ${body.age}</p>
      <p><strong>Employment:</strong> ${body.employment_status}</p>
      <p><strong>30 days since FI reply:</strong> ${body.thirty_days_since_last_fi_reply ? 'Yes' : 'No'}</p>
      <p><strong>FI final response issued:</strong> ${body.fi_issued_final_response ? 'Yes' : 'No'}</p>
      <p><strong>Amount lost (snapshot):</strong> ${amountLostSgd ?? 'n/a'}</p>
      <p><strong>Institution (snapshot):</strong> ${financialInstitution ?? 'n/a'}</p>
      <p><strong>Message:</strong> ${body.message ?? '(none)'}</p>
    `,
  }).catch((err) => {
    console.error('[contact-requests] email send failed', err)
  })

  return NextResponse.json({ ok: true, id: row.id }, { status: 201 })
}
