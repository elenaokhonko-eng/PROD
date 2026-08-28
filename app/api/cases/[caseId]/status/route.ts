import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createUserClient } from '@/lib/supabase/server'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { caseId } = await params
  const { status } = await request.json()

  const supabase = await createUserClient()

  const { data: updatedCase, error } = await supabase
    .from('cases')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', caseId)
    .select('id')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!updatedCase) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
