import { NextResponse } from 'next/server'
import { z } from 'zod'
import { factsCaseAccess } from '@/lib/server/facts/case-access'
import { recordFault } from '@/lib/server/fault-log'
import { createServiceClient } from '@/lib/supabase/service'

// Requirements 8.3: a file the screen refuses before sending is counted like one the server refuses. The fault and the
// case ID only: no file name, no content.
export const dynamic = 'force-dynamic'

const Body = z.object({ caseId: z.string().uuid(), fault: z.enum(['too_long', 'too_many']) })

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_refusal' }, { status: 400 })
  const access = await factsCaseAccess(parsed.data.caseId)
  if (access instanceof NextResponse) return access
  await recordFault(createServiceClient(), parsed.data.fault, parsed.data.caseId)
  return new NextResponse(null, { status: 204 })
}
