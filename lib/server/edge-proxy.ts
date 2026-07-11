/**
 * Server-side edge-function proxy — single implementation of the blanket auth
 * boundary described in `docs/Front-to-Back-End-Integration-Summary.md §9.2`.
 *
 * Every `/api/edge/*` route delegates to `proxyEdgeFunction(...)`. This keeps
 * auth (Clerk JWT → Pattern C), ownership probe (user-scoped SELECT enforced
 * by RLS), service-role fanout, and response forwarding in one place.
 *
 * Reference implementation — do NOT duplicate this logic per route.
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createUserClient } from '@/lib/supabase/server'

export interface ProxyOptions {
  /** Supabase edge-function folder name (see `lib/edge-functions.ts`). */
  fnName: string
  /** The Next.js `Request`. We parse JSON from it; the raw body is not used. */
  request: Request
  /**
   * Optional body mutator called AFTER the ownership probe and BEFORE the
   * edge function is invoked. Use it to inject server-only secrets (for
   * example, `simulation_key` on `run_report_selfserve_v1`).
   */
  mutateBody?: (body: Record<string, unknown>) => Record<string, unknown>
  /**
   * Which field in the body carries the `case_id` used for the ownership
   * probe. Defaults to `case_id`. For evidence routes where only
   * `document_id` is sent, set this to `null` to opt out and rely on the
   * custom probe below.
   */
  caseIdField?: string | null
  /**
   * Custom ownership probe, used when `case_id` is not directly in the body
   * (e.g. evidence routes POST `document_id`; we still need to prove the
   * user owns the parent case).
   *
   * Must return `{ ok: true }` if the user may proceed, `{ ok: false, status }`
   * otherwise. Runs with the user-scoped client (RLS enforced).
   */
  probe?: (
    userClient: Awaited<ReturnType<typeof createUserClient>>,
    body: Record<string, unknown>,
  ) => Promise<{ ok: boolean; status?: number }>
}

/**
 * Proxy a request to a Supabase edge function with Pattern C auth + RLS
 * ownership probe + service-role outbound. Returns a `Response` that the
 * `/api/edge/*` route handler can return directly.
 */
export async function proxyEdgeFunction({
  fnName,
  request,
  mutateBody,
  caseIdField = 'case_id',
  probe,
}: ProxyOptions): Promise<Response> {
  // 1) Clerk session -> 401 if missing.
  const { userId, getToken } = await auth()
  const userSupabaseJwt = userId ? await getToken({ template: 'supabase' }) : null
  if (!userId || !userSupabaseJwt) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2) Parse and validate the body. The edge functions only accept JSON.
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // 3) Ownership probe (RLS enforced). Either the default "case_id ∈ cases"
  //    probe or a custom probe supplied by the caller. Missing probes
  //    short-circuit with 400 so nobody accidentally ships an unprobed
  //    wrapper.
  const userClient = await createUserClient()

  if (probe) {
    const probeResult = await probe(userClient, body)
    if (!probeResult.ok) {
      return NextResponse.json(
        { error: probeResult.status === 404 ? 'Not found' : 'Forbidden' },
        { status: probeResult.status ?? 404 },
      )
    }
  } else if (caseIdField) {
    const caseId = body[caseIdField]
    if (typeof caseId !== 'string' || caseId.length === 0) {
      return NextResponse.json(
        { error: `${caseIdField} is required` },
        { status: 400 },
      )
    }

    const { data: own, error: ownErr } = await userClient
      .from('cases')
      .select('id')
      .eq('id', caseId)
      .maybeSingle()

    if (ownErr) {
      // RLS denial typically surfaces as either no row or an error — both
      // treated as 404 to avoid leaking the existence of the case.
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (!own) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
  } else {
    return NextResponse.json(
      {
        error:
          'proxyEdgeFunction called without caseIdField or probe — refusing to forward unauthenticated request',
      },
      { status: 500 },
    )
  }

  // 4) Mutate body with server-only secrets if needed.
  const forwardBody = mutateBody ? mutateBody(body) : body

  // 5) Fanout to Edge Function using the caller's Supabase JWT.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: 'Edge proxy is not configured (missing Supabase URL or anon key)' },
      { status: 500 },
    )
  }

  const jwtPayload = (() => {
    try {
      const parts = userSupabaseJwt.split('.')
      if (parts.length < 2) return null
      const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
      return JSON.parse(payload) as { aud?: string; iss?: string; role?: string }
    } catch {
      return null
    }
  })()
  const urlHost = (() => {
    try {
      return new URL(supabaseUrl).host
    } catch {
      return null
    }
  })()

  const edgeRes = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify(forwardBody),
  })

  // Preserve the edge function's status code. Parse JSON defensively — some
  // failure paths return non-JSON.
  const text = await edgeRes.text()
  let data: unknown
  try {
    data = text.length > 0 ? JSON.parse(text) : null
  } catch {
    data = { ok: false, error: text.slice(0, 500) }
  }

  return NextResponse.json(data, { status: edgeRes.status })
}
