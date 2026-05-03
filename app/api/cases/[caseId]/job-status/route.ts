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

type JobRow = {
  id: string
  case_id: string
  status: string
  error: string | null
  created_at: string
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  })

  const { data: caseRow, error: caseErr } = await supabase
    .from('cases')
    .select('id')
    .eq('id', caseId)
    .eq('user_id', supabaseUuid)
    .maybeSingle()

  if (caseErr) {
    return NextResponse.json({ error: caseErr.message }, { status: 500 })
  }
  if (!caseRow) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id, case_id, status, error, created_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (jobErr) {
    // jobs table may not exist in pre-slice-6 envs; keep contract stable.
    const missingJobsTable =
      jobErr.code === '42P01' ||
      jobErr.message.includes("Could not find the table 'public.jobs' in the schema cache")
    if (missingJobsTable) {
      return NextResponse.json({ status: 'none', error: null })
    }
    return NextResponse.json({ error: jobErr.message }, { status: 500 })
  }

  if (!job) {
    return NextResponse.json({ status: 'none', error: null })
  }

  const row = job as JobRow
  return NextResponse.json({ status: row.status, error: row.error ?? null, id: row.id })
}
