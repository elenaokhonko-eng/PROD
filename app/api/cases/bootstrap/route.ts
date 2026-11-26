import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { linkNewAccount } from '@/lib/server/current-user'
import { invalidFields, logRefusal } from '@/lib/server/refusal-log'
import { createUserClient } from '@/lib/supabase/server'
import { HOURLY_LIMIT_MESSAGE, limitResponse, overCaseLimit, overIpModelLimit } from '@/lib/server/usage-limits'

const BootstrapBody = z.object({
  narrative: z.string().min(1).max(20000),
  transcript: z.string().max(20000).optional(),
  claim_type: z.enum(["phishing_scam", "mis_sold_product", "denied_insurance"]).optional(),
  title: z.string().max(200).optional(),
})

export async function POST(req: Request) {
  const user = (await getCurrentUser()) ?? (await linkNewAccount())
  if (!user) {
    logRefusal('case_start', 'unauthorized', 401)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const parsed = BootstrapBody.safeParse(await req.json())
  if (!parsed.success) {
    logRefusal('case_start', 'invalid_body', 400, { fields: invalidFields(parsed.error) })
    return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 })
  }
  const { narrative, transcript, claim_type } = parsed.data
  const idempotencyKey = req.headers.get('idempotency-key')?.trim()
  if (!idempotencyKey || idempotencyKey.length > 200) {
    logRefusal('case_start', 'valid_idempotency_key_required', 400)
    return NextResponse.json({ error: 'valid_idempotency_key_required' }, { status: 400 })
  }

  const normalizedRequest = {
    narrative,
    transcript: transcript ?? null,
    claim_type: claim_type ?? 'phishing_scam',
  }
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')

  const supabase = await createUserClient()
  const story = {
    p_narrative: normalizedRequest.narrative,
    p_transcript: normalizedRequest.transcript,
    p_claim_type: normalizedRequest.claim_type,
    p_idempotency_key_hash: hash(idempotencyKey),
    p_request_hash: hash(JSON.stringify(normalizedRequest)),
  }

  // Elena, 27 Nov: any story, from the dashboard or the public home page, first fills the case waiting for one, so a
  // person never ends up with a paid empty case beside an unpaid real one. It creates no case (that one was counted when it was opened), so only the
  // hourly limit on model work applies. With none waiting, a new case is started below, under both limits.
  const { data: waiting } = await supabase
    .from('cases')
    .select('id')
    .eq('user_id', user.supabaseUuid)
    .not('pack_first_at', 'is', null)
    .is('primary_narrative', null)
    .limit(1)
  if (waiting?.length) {
    if (overIpModelLimit(req)) return limitResponse(HOURLY_LIMIT_MESSAGE)
    const { data: filledCaseId, error: fillError } = await supabase.rpc('fill_pack_case_v1', story)
    if (fillError) {
      logRefusal('case_start', 'case_bootstrap_failed', 500, { code: fillError.code ?? null })
      return NextResponse.json({ error: 'case_bootstrap_failed' }, { status: 500 })
    }
    if (filledCaseId) return NextResponse.json({ case_id: filledCaseId }, { status: 201 })
  }

  // A new case starts model work: limited per account per day and per IP per hour (cost-controls §5 B1).
  // limitResponse logs its own refusals.
  if (await overCaseLimit(user.supabaseUuid)) return limitResponse()
  if (overIpModelLimit(req)) return limitResponse(HOURLY_LIMIT_MESSAGE)

  const { data: caseId, error } = await supabase.rpc('bootstrap_case_v1', story)

  if (error || !caseId) {
    logRefusal('case_start', 'case_bootstrap_failed', 500, { code: error?.code ?? null })
    return NextResponse.json({ error: 'case_bootstrap_failed' }, { status: 500 })
  }

  return NextResponse.json({ case_id: caseId }, { status: 201 })
}
