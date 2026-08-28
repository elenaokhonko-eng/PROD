import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createUserClient } from '@/lib/supabase/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { caseId } = await params
  const supabase = await createUserClient()

  const { data: caseData } = await supabase
    .from('cases')
    .select('id')
    .eq('id', caseId)
    .maybeSingle()

  if (!caseData) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('case_documents')
    .select('id, processing_status')
    .eq('case_id', caseId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ documents: data ?? [] })
}
