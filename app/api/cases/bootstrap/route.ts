import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { createUserClient } from '@/lib/supabase/server'

const BootstrapBody = z.object({
  narrative: z.string().min(1).max(20000),
  transcript: z.string().max(20000).optional(),
  claim_type: z.enum(["phishing_scam", "mis_sold_product", "denied_insurance"]).optional(),
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
  const idempotencyKey = req.headers.get('idempotency-key')?.trim()
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return NextResponse.json({ error: 'valid_idempotency_key_required' }, { status: 400 })
  }

  const normalizedRequest = {
    narrative,
    transcript: transcript ?? null,
    claim_type: claim_type ?? 'phishing_scam',
  }
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')

  const supabase = await createUserClient()
  const { data: caseId, error } = await supabase.rpc('bootstrap_case_v1', {
    p_narrative: normalizedRequest.narrative,
    p_transcript: normalizedRequest.transcript,
    p_claim_type: normalizedRequest.claim_type,
    p_idempotency_key_hash: hash(idempotencyKey),
    p_request_hash: hash(JSON.stringify(normalizedRequest)),
  })

  if (error || !caseId) {
    return NextResponse.json({ error: 'case_bootstrap_failed' }, { status: 500 })
  }

  return NextResponse.json({ case_id: caseId }, { status: 201 })
}
