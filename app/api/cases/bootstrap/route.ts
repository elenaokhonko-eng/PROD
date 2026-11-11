import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@clerk/nextjs/server'
import { getCurrentUser } from '@/lib/auth'
import { provisionClerkProfileWithRuntimeDependencies } from '@/lib/server/clerk-profile-provisioner'
import { createUserClient } from '@/lib/supabase/server'
import { HOURLY_LIMIT_MESSAGE, limitResponse, overCaseLimit, overIpModelLimit } from '@/lib/server/usage-limits'

const BootstrapBody = z.object({
  narrative: z.string().min(1).max(20000),
  transcript: z.string().max(20000).optional(),
  claim_type: z.enum(["phishing_scam", "mis_sold_product", "denied_insurance"]).optional(),
  title: z.string().max(200).optional(),
})

// A brand-new account can reach this before Clerk's user.created webhook has linked it to its profile, so its token has
// no supabase_uuid yet and the case could not start (G3b re-check, 11 Nov). Link it here; provisioning is idempotent, so
// racing the webhook is harmless.
async function currentUserLinkingNewAccount() {
  const user = await getCurrentUser()
  if (user) return user
  const { userId } = await auth()
  if (!userId) return null
  try {
    await provisionClerkProfileWithRuntimeDependencies(userId)
  } catch (error) {
    console.warn('[bootstrap] New account could not be linked yet', { name: (error as Error)?.name })
    return null
  }
  return getCurrentUser()
}

export async function POST(req: Request) {
  const user = await currentUserLinkingNewAccount()
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

  // A new case starts model work: limited per account per day and per IP per hour (cost-controls §5 B1).
  if (await overCaseLimit(user.supabaseUuid)) return limitResponse()
  if (overIpModelLimit(req)) return limitResponse(HOURLY_LIMIT_MESSAGE)

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
