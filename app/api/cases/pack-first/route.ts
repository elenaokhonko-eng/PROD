import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { productSwitchedOn } from '@/lib/billing/product-readiness'
import { PACK_PRODUCT } from '@/lib/journey/pack-case'
import { linkNewAccount } from '@/lib/server/current-user'
import { invalidFields, logRefusal } from '@/lib/server/refusal-log'
import { safeErrorText } from '@/lib/server/safe-error'
import { limitResponse, overCaseLimit } from '@/lib/server/usage-limits'
import { createServiceClient } from '@/lib/supabase/service'

// CR-2: the case a pack bought before the story attaches to. The account's case still waiting for its story is reused;
// only the server can create one (open_pack_case_v1 is not granted to signed-in users).

const Body = z.object({ product: z.enum(['bank', 'fidrec']) }).strict()

export async function POST(request: Request) {
  const user = (await getCurrentUser()) ?? (await linkNewAccount())
  if (!user) {
    logRefusal('case_start', 'unauthorized', 401)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    logRefusal('case_start', 'invalid_body', 400, { fields: invalidFields(parsed.error) })
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const productKey = PACK_PRODUCT[parsed.data.product]
  if (!productSwitchedOn(productKey)) {
    logRefusal('case_start', 'product_not_available', 409, { productKey })
    return NextResponse.json({ error: 'Product is not available yet', reason: 'product_not_available' }, { status: 409 })
  }

  const service = createServiceClient()
  const open = (create: boolean) =>
    service.rpc('open_pack_case_v1', { p_owner_profile_id: user.supabaseUuid, p_create: create })

  let result = await open(false)
  if (!result.error && !result.data) {
    // A new case counts towards the daily limit, as one started from a story does; limitResponse logs the refusal.
    if (await overCaseLimit(user.supabaseUuid)) return limitResponse()
    result = await open(true)
  }
  if (result.error || !result.data) {
    console.error('[pack-case] could not open a case', safeErrorText(result.error))
    return NextResponse.json({ error: 'pack_case_failed' }, { status: 500 })
  }

  return NextResponse.json({ case_id: result.data as string })
}
