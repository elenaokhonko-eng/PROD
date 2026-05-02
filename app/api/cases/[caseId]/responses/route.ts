import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payloadPart = parts[1]
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const authHeader = request.headers.get('authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
  // #region agent log
  fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'initial-debug',hypothesisId:'H2',location:'responses/route.ts:25',message:'responses route auth header inspection',data:{hasAuthHeader:Boolean(authHeader),hasBearer:Boolean(bearer)},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  if (!bearer) {
    return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 })
  }

  const payload = decodeJwtPayload(bearer)
  const supabaseUuid = typeof payload?.supabase_uuid === 'string' ? payload.supabase_uuid : null
  // #region agent log
  fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'initial-debug',hypothesisId:'H4',location:'responses/route.ts:33',message:'responses route JWT claim inspection',data:{hasPayload:Boolean(payload),hasSupabaseUuid:Boolean(supabaseUuid)},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  if (!supabaseUuid) {
    return NextResponse.json({ error: 'Invalid token: missing supabase_uuid claim' }, { status: 401 })
  }

  const { caseId } = await params
  const { responses } = await request.json()

  if (!Array.isArray(responses)) {
    return NextResponse.json(
      { error: 'responses must be an array' },
      { status: 400 }
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  })

  // Verify case ownership
  const { data: caseData, error: caseErr } = await supabase
    .from('cases')
    .select('id')
    .eq('id', caseId)
    .eq('user_id', supabaseUuid)
    .single()
  // #region agent log
  fetch('http://127.0.0.1:7824/ingest/26574370-b756-4c84-85f8-f03b9a8ce807',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5b59f2'},body:JSON.stringify({sessionId:'5b59f2',runId:'initial-debug',hypothesisId:'H5',location:'responses/route.ts:66',message:'responses route case ownership lookup',data:{hasCaseData:Boolean(caseData),caseErrCode:caseErr?.code ?? null,caseErrMessage:caseErr?.message ?? null},timestamp:Date.now()})}).catch(()=>{})
  // #endregion

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
