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
  if (!bearer) {
    return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 })
  }

  const payload = decodeJwtPayload(bearer)
  const supabaseUuid = typeof payload?.supabase_uuid === 'string' ? payload.supabase_uuid : null
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
    .maybeSingle()

  if (caseErr) {
    return NextResponse.json({ error: caseErr.message }, { status: 400 })
  }

  if (!caseData) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  const saved: string[] = []

  for (const response of responses as Array<{
    question_key?: unknown
    response_value?: unknown
    response_type?: unknown
  }>) {
    const questionKey =
      typeof response.question_key === 'string' ? response.question_key.trim() : ''
    if (!questionKey || questionKey === 'undefined') {
      return NextResponse.json(
        { error: 'Invalid response: question_key is required' },
        { status: 400 },
      )
    }

    const responseType =
      typeof response.response_type === 'string' && response.response_type
        ? response.response_type
        : 'text'
    const responseValue =
      typeof response.response_value === 'string'
        ? response.response_value
        : JSON.stringify(response.response_value ?? '')

    const payload = {
      response_value: responseValue,
      response_type: responseType,
    }

    const { data: existingRows, error: updateError } = await supabase
      .from('case_responses')
      .update(payload)
      .eq('case_id', caseId)
      .eq('question_key', questionKey)
      .select('id')

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 })
    }

    if (existingRows && existingRows.length > 0) {
      saved.push(...existingRows.map((row) => row.id as string))
      continue
    }

    const { data: inserted, error: insertError } = await supabase
      .from('case_responses')
      .insert({
        case_id: caseId,
        question_key: questionKey,
        ...payload,
      })
      .select('id')
      .single()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 })
    }

    if (inserted?.id) {
      saved.push(inserted.id)
    }
  }

  return NextResponse.json({ ok: true, saved })
}
