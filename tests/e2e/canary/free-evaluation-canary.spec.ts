import { expect, type Page, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import {
  answerFollowUpsUntil,
  answerJourney,
  expectFreeEvaluation,
  fillIntake,
  reachEvidenceUpload,
  resolveOpenFindings,
  smsPhishingNarrative,
  stepTimeoutMs,
  syntheticStatementPdf,
} from '../helpers/fresh-account'

// Production canary (cutover gate 7, prepared 8 Nov): a fresh account submits a fixed synthetic story, confirms the
// facts and gets the free evaluation, each step within its time budget, then everything it created is deleted. The
// account is marked as the canary (email prefix "guidebuoy-canary+" and Clerk public metadata canary=true) so usage
// figures exclude it. Every value is synthetic.

const BUDGET_MS = { caseCreated: 3 * 60_000, factsReady: 4 * 60_000, evaluation: 3 * 60_000, total: 15 * 60_000 }
const clerkKey = process.env.CANARY_CLERK_SECRET_KEY ?? ''
const supabase = createClient(process.env.CANARY_SUPABASE_URL ?? 'http://unset.invalid', process.env.CANARY_SUPABASE_SERVICE_ROLE_KEY ?? 'unset', {
  auth: { persistSession: false, autoRefreshToken: false },
})

const clerk = (path: string, init: RequestInit = {}) =>
  fetch(`https://api.clerk.com/v1${path}`, { ...init, headers: { Authorization: `Bearer ${clerkKey}`, 'Content-Type': 'application/json' } })

test('production free evaluation canary', async ({ page }) => {
  for (const name of ['CANARY_BASE_URL', 'CANARY_CLERK_SECRET_KEY', 'CANARY_SUPABASE_URL', 'CANARY_SUPABASE_SERVICE_ROLE_KEY']) {
    expect(process.env[name], `${name} is set`).toBeTruthy()
  }
  const started = Date.now()
  const created = await clerk('/users', {
    method: 'POST',
    body: JSON.stringify({
      email_address: [`guidebuoy-canary+${Date.now()}@guidebuoyai.sg`],
      skip_password_requirement: true,
      public_metadata: { canary: true },
    }),
  })
  const clerkUserId = ((await created.json()) as { id?: string }).id
  expect(clerkUserId, `canary user (HTTP ${created.status})`).toMatch(/^user_/)
  let caseId: string | null = null
  try {
    await signIn(page, clerkUserId!)
    await page.evaluate((story) => sessionStorage.setItem('gb_pending_narrative', JSON.stringify({ narrative: story })), smsPhishingNarrative)
    await page.goto('/onboarding')
    await page.waitForURL(/\/app\/case\/[0-9a-f-]{36}\/dashboard$/, { timeout: BUDGET_MS.caseCreated })
    caseId = new URL(page.url()).pathname.split('/')[3]

    await answerJourney(page)
    await fillIntake(page, smsPhishingNarrative)
    await reachEvidenceUpload(page)
    await page.locator('input[type="file"]').setInputFiles({ name: 'synthetic-bank-statement.pdf', mimeType: 'application/pdf', buffer: syntheticStatementPdf() })
    const factsStarted = Date.now()
    await answerFollowUpsUntil(page, page.getByRole('heading', { name: 'Confirm your facts', exact: true }), Math.min(stepTimeoutMs, BUDGET_MS.factsReady))
    await resolveOpenFindings(page, caseId)
    console.log(`canary: facts ready in ${Math.round((Date.now() - factsStarted) / 1000)} s`)

    const evaluationStarted = Date.now()
    const generated = page.waitForResponse((r) => r.url().endsWith('/api/edge/tier0') && r.request().method() === 'POST', { timeout: BUDGET_MS.evaluation })
    await page.getByRole('button', { name: 'Confirm and continue to your free evaluation' }).click()
    const response = await generated
    expect(response.status(), 'the free evaluation is generated').toBe(200)
    const source = ((await response.json()) as { outputs?: { summary_source?: string } }).outputs?.summary_source
    await expectFreeEvaluation(page)
    console.log(`canary: evaluation in ${Math.round((Date.now() - evaluationStarted) / 1000)} s (summary: ${source ?? 'unknown'})`)
    expect(Date.now() - started, 'whole journey within budget').toBeLessThan(BUDGET_MS.total)
  } finally {
    await cleanUp(clerkUserId!, caseId)
  }
})

async function signIn(page: Page, clerkUserId: string) {
  const response = await clerk('/sign_in_tokens', { method: 'POST', body: JSON.stringify({ user_id: clerkUserId, expires_in_seconds: 300 }) })
  const { token } = (await response.json()) as { token?: string }
  expect(token, `sign-in token (HTTP ${response.status})`).toBeTruthy()
  await page.goto('/sign-in', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean((window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded), undefined, { timeout: 60_000 })
  const status = await page.evaluate(async (ticket) => {
    const { Clerk } = window as unknown as {
      Clerk: {
        client: { signIn: { create(p: { strategy: 'ticket'; ticket: string }): Promise<{ status: string; createdSessionId: string }> } }
        setActive(p: { session: string }): Promise<void>
      }
    }
    const attempt = await Clerk.client.signIn.create({ strategy: 'ticket', ticket })
    if (attempt.status !== 'complete') return attempt.status
    await Clerk.setActive({ session: attempt.createdSessionId })
    return 'complete'
  }, token!)
  expect(status).toBe('complete')
}

// docs/runbooks/privacy-case-deletion.md for the canary's own account: files, the case (cascades), unlinked rows,
// the profile and the Clerk user. Counts only in the log.
async function cleanUp(clerkUserId: string, caseId: string | null) {
  const { data: profile } = await supabase.from('profiles').select('id').eq('clerk_id', clerkUserId).maybeSingle()
  const profileId = (profile as { id?: string } | null)?.id ?? null
  const { data: cases } = profileId ? await supabase.from('cases').select('id').eq('user_id', profileId) : { data: [] }
  const caseIds = [...new Set([...(cases ?? []).map((c) => (c as { id: string }).id), ...(caseId ? [caseId] : [])])]
  for (const id of caseIds) {
    const { data: docs } = await supabase.from('case_documents').select('storage_path').eq('case_id', id)
    const paths = (docs ?? []).map((d) => (d as { storage_path: string | null }).storage_path).filter((p): p is string => Boolean(p))
    if (paths.length) await supabase.storage.from('evidence').remove(paths)
    await supabase.from('cases').delete().eq('id', id)
    await supabase.from('analytics_events').delete().eq('event_data->>case_id', id)
    await supabase.from('edge_request_nonces').delete().eq('case_id', id)
  }
  if (profileId) {
    await supabase.from('analytics_events').delete().eq('user_id', profileId)
    await supabase.from('profiles').delete().eq('id', profileId)
  }
  const deleted = await clerk(`/users/${clerkUserId}`, { method: 'DELETE' })
  console.log(`canary cleanup: ${caseIds.length} case(s), profile ${profileId ? 'deleted' : 'none'}, Clerk user HTTP ${deleted.status}`)
}
