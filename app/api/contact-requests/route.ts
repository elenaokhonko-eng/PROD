import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { createUserClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
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
}).strict()

const FORBIDDEN_CLIENT_FIELDS = ['user_id', 'amount_lost_sgd', 'financial_institution'] as const

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const rawBody: unknown = await req.json()
  const forbiddenFields =
    rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? FORBIDDEN_CLIENT_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(rawBody, field))
      : []

  if (forbiddenFields.length > 0) {
    return NextResponse.json(
      {
        error: 'forbidden_client_fields',
        details: {
          fields: forbiddenFields,
          message: 'Server-owned fields must not be sent by the client.',
        },
      },
      { status: 400 },
    )
  }

  const parsed = Body.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

  const supabase = await createUserClient()

  // Pattern C: ownership probe via RLS on cases, then derive denormalized
  // escalation_waitlist.user_id from cases.user_id (never request body / JWT alone).
  const { data: snapshot, error: snapshotErr } = await supabase
    .from('cases')
    .select(
      `
      id,
      user_id,
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

  const caseOwnerId =
    typeof snapshot.user_id === 'string' && snapshot.user_id.length > 0
      ? snapshot.user_id
      : null
  if (!caseOwnerId) {
    return NextResponse.json({ error: 'case_missing_owner' }, { status: 500 })
  }

  const extract = (snapshot.latest_extract?.[0]?.extract_json ?? null) as
    | {
        reported_loss?: { amount?: number | string | null }
        losses?: { reported_loss?: { amount?: number | string | null } } | Array<{ amount?: number | string | null }>
        case_meta?: { claim_amount?: number | string | null; institution_name?: string | null }
      }
    | null

  const amountLostSgd = extractReportedLossAmount(extract) ?? coerceNumber(snapshot.claim_amount)
  const financialInstitution = extract?.case_meta?.institution_name ?? snapshot.institution_name ?? null

  const serviceSupabase = createServiceClient()
  const { data: row, error: insertErr } = await serviceSupabase
    .from('escalation_waitlist')
    .upsert(
      {
        user_id: caseOwnerId,
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

function extractReportedLossAmount(
  extract:
    | {
        reported_loss?: { amount?: number | string | null }
        losses?: { reported_loss?: { amount?: number | string | null } } | Array<{ amount?: number | string | null }>
        case_meta?: { claim_amount?: number | string | null }
      }
    | null,
): number | null {
  return (
    coerceNumber(extract?.reported_loss?.amount) ??
    coerceNumber(Array.isArray(extract?.losses) ? extract.losses[0]?.amount : extract?.losses?.reported_loss?.amount) ??
    coerceNumber(extract?.case_meta?.claim_amount)
  )
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
