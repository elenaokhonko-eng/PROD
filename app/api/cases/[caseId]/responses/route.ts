import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { caseId } = await params
  const { responses } = await request.json()

  if (!Array.isArray(responses)) {
    return NextResponse.json(
      { error: 'responses must be an array' },
      { status: 400 }
    )
  }

  const supabase = await createClient()

  // Verify case ownership
  const { data: caseData } = await supabase
    .from('cases')
    .select('id')
    .eq('id', caseId)
    .eq('user_id', user.profileId)
    .single()

  if (!caseData) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  const upsertPromises = responses.map(
    (r: { question_key: string; response_value: string; response_type?: string }) =>
      supabase.from('case_responses').upsert(
        {
          case_id: caseId,
          question_key: r.question_key,
          response_value: r.response_value,
          response_type: r.response_type || 'text',
        },
        { onConflict: 'case_id,question_key' }
      )
  )

  await Promise.all(upsertPromises)

  return NextResponse.json({ ok: true })
}
