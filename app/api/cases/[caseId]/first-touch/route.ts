import { NextResponse } from 'next/server'
import { firstTouchSchema } from '@/lib/analytics/funnel-schema'
import { factsCaseAccess } from '@/lib/server/facts/case-access'
import { createServiceClient } from '@/lib/supabase/service'

// Analytics 2 (adviser's addition, approved by Elena 14 Nov 2026): the channel a new case's visitor first came from,
// stored once on the case so evaluations can be counted by channel. Owner only; never overwrites.
export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params
  const access = await factsCaseAccess(caseId)
  if (access instanceof NextResponse) return access
  if (!access.isOwner) return NextResponse.json({ error: 'Only the case owner can do this' }, { status: 403 })

  const parsed = firstTouchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_first_touch' }, { status: 400 })

  const touch = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== null && value !== undefined))
  const { error } = await createServiceClient()
    .from('cases')
    .update({ first_touch: touch })
    .eq('id', caseId)
    .is('first_touch', null)
  if (error) return NextResponse.json({ error: 'Not recorded' }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
