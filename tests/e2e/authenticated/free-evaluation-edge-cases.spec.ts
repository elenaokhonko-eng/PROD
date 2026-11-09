import type { APIResponse, Browser, Page } from '@playwright/test'
import { expect, expectNoProductionTraffic, guardContextAgainstProduction, test } from '../fixtures/harbor-test'
import { resolveAuthStatePath } from '../evidence/run-context'
import { readReleaseFixtures } from '../../release/release-fixtures'
import { refreshClerkSession } from '../helpers/clerk-session'
import { createServiceClientFromEnvironment } from '../helpers/disposable-records'
import {
  answerFollowUpsUntil,
  answerJourney,
  clerkApi,
  deleteClerkUser,
  expectFreeEvaluation,
  fillIntake,
  reachEvidenceUpload,
  resolveOpenFindings,
  type ServiceClient,
  signIn,
  smsPhishingNarrative,
  startFreshCase,
  stepTimeoutMs,
  syntheticStatementPdf,
} from '../helpers/fresh-account'

// Free-evaluation hardening item 4 (8 Nov): the flow and state edge cases around confirming facts and generating the
// free evaluation, on one brand-new account so every step runs against real staging state. Synthetic content only;
// the Clerk test user is deleted afterwards.

const fixtures = readReleaseFixtures()
const baseURL = process.env.HARBOR_PREVIEW_BASE_URL!
const CONFIRM = 'Confirm and continue to your free evaluation'
const FAILED_CARD = 'We couldn’t prepare your free evaluation'
const NARRATIVE_TYPES = ['tier0_summary', 'tier0_evidence_checklist', 'tier0_confirmed_facts', 'tier0_srf_signal']
// "Out of date" wording is not fixed yet; any of these tells the person the evaluation no longer matches their facts.
const OUT_OF_DATE = /out of date|facts (have )?changed|no longer match/i

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('free evaluation edge cases', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-1440', 'Creates a Clerk user once per release SHA.')
  })

  test('session expiry, two tabs, double-click, refresh mid-generation, changed answers and a removed document', async ({ page, browser }) => {
    test.setTimeout(45 * 60_000)
    const supabase = createServiceClientFromEnvironment()
    const { clerkUserId, caseId } = await startFreshCase(page, supabase, smsPhishingNarrative)
    const dashboard = `/app/case/${caseId}/dashboard`

    try {
      await answerJourney(page)
      await fillIntake(page, smsPhishingNarrative)
      await reachEvidenceUpload(page)
      await page.locator('input[type="file"]').setInputFiles({ name: 'synthetic-bank-statement.pdf', mimeType: 'application/pdf', buffer: syntheticStatementPdf() })
      await answerFollowUpsUntil(page, page.getByRole('heading', { name: 'Confirm your facts', exact: true }), stepTimeoutMs)

      await test.step('(d) a session that expires during the fact check sends the person to sign in and keeps their answers', async () => {
        await resolveOpenFindings(page, caseId, { rounds: 1 })
        const answeredBefore = await answeredFindings(supabase, caseId)
        expect(answeredBefore, 'one answer saved before the session expires').toBeGreaterThan(0)

        const sessionId = await page.evaluate(() => (window as unknown as { Clerk?: { session?: { id?: string } } }).Clerk?.session?.id ?? null)
        expect(sessionId).toMatch(/^sess_/)
        const revoked = await clerkApi(`/sessions/${sessionId}/revoke`, { method: 'POST' })
        expect(revoked.status, 'Clerk revokes the session').toBe(200)
        await expect
          .poll(async () => ((await (await clerkApi(`/sessions/${sessionId}`, { method: 'GET' })).json()) as { status?: string }).status, { timeout: 60_000 })
          .toBe('revoked')
        // A real expiry: no token minted before the revocation is still valid (Supabase JWT template lifetime 60 s + 5 s).
        await page.context().clearCookies()
        await page.waitForTimeout(70_000)

        await page.goto(dashboard)
        await page.waitForURL(/\/sign-in/, { timeout: 60_000 })
        const returnTo = new URL(page.url()).searchParams.get('redirect_url') ?? ''
        expect(decodeURIComponent(returnTo), 'sign-in returns to the case').toContain(dashboard)

        await signIn(page, clerkUserId)
        await page.goto(returnTo)
        await page.waitForURL(new RegExp(`${dashboard}$`), { timeout: 60_000 })
        await expect(page.getByRole('heading', { name: 'Confirm your facts', exact: true })).toBeVisible({ timeout: 120_000 })
        expect(await answeredFindings(supabase, caseId), 'no saved answer was lost').toBeGreaterThanOrEqual(answeredBefore)
      })

      await resolveOpenFindings(page, caseId)

      // (c) A second tab on the same case, also on the confirm screen.
      const second = await page.context().newPage()
      await second.goto(dashboard)
      await expect(second.getByText('Everything is confirmed.')).toBeVisible({ timeout: 360_000 })

      const tier0Posts: string[] = []
      page.on('request', (r) => {
        if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/edge/tier0') tier0Posts.push(r.url())
      })

      await test.step('(a) double-clicking confirm starts one generation from one snapshot', async () => {
        const sent = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/edge/tier0', { timeout: 120_000 })
        await page.getByRole('button', { name: CONFIRM }).dblclick()
        await sent
        await page.waitForTimeout(2_000)
        expect.soft(tier0Posts, 'one generation request').toHaveLength(1)
      })

      await test.step('(b) refreshing mid-generation recovers without a second automatic generation or a failure', async () => {
        const sentBeforeRefresh = tier0Posts.length
        await page.reload()
        await expect(page.getByText(FAILED_CARD)).toHaveCount(0)
        await expect
          .poll(async () => (await narrativeRows(supabase, caseId)).filter((r) => r.narrative_type === 'tier0_summary').length, {
            timeout: 180_000,
            message: 'the generation started before the refresh finishes on the server',
          })
          .toBeGreaterThan(0)
        expect(tier0Posts, 'the refreshed page did not start another generation by itself').toHaveLength(sentBeforeRefresh)
        await page.reload()
        await expectFreeEvaluation(page)
        await expect(page.getByText(FAILED_CARD)).toHaveCount(0)
        expect(await snapshotIds(supabase, caseId), 'one snapshot').toHaveLength(1)
        await expectOneSetOfNarratives(supabase, caseId)
      })

      await test.step('(c) the second tab does not create a conflicting snapshot and shows the current state', async () => {
        // The stale tab still offers "Confirm": pressing it must reuse the same snapshot and end in the evaluation or
        // a clear "check again" message, never the generic failure.
        await second.getByRole('button', { name: CONFIRM }).click()
        await expect(second.getByRole('heading', { name: 'Your free evaluation', exact: true }).or(second.getByText(/Your facts changed since you confirmed them/))).toBeVisible({ timeout: 180_000 })
        await expect(second.getByText('Something went wrong. Your answers are saved; please try again.')).toHaveCount(0)
        await second.reload()
        await expectFreeEvaluation(second)
        expect(await snapshotIds(supabase, caseId), 'still one snapshot').toHaveLength(1)
        await expectOneSetOfNarratives(supabase, caseId)
        await second.close()
      })

      await test.step('(e) changing an answer after confirmation reopens the facts, marks the evaluation out of date and regenerates', async () => {
        const [firstSnapshot] = await snapshotIds(supabase, caseId)
        await page.goto(`/app/case/${caseId}/facts?stage=free`)
        // Unchanged facts open on "Your facts haven’t changed"; the answers are behind "Review my facts".
        await page.getByRole('button', { name: 'Review my facts' }).click({ timeout: 360_000 })
        const first = page.locator('[data-finding]').filter({ has: page.getByRole('button', { name: 'Change' }) }).first()
        await expect(first).toBeVisible({ timeout: 60_000 })
        // Pinned by id: once "Change" is pressed the card no longer matches the filter above.
        const answered = page.locator(`#finding-${await first.getAttribute('data-finding')}`)
        await first.getByRole('button', { name: 'Change' }).click()
        const unsure = answered.getByText('I’m not sure', { exact: true })
        if (await unsure.count()) await unsure.click()
        else await answered.locator('label:has(input.sr-only:not(:checked))').first().click()
        const saved = page.waitForResponse((r) => r.url().includes(`/api/cases/${caseId}/facts?stage=free`) && r.request().method() === 'GET', { timeout: 120_000 })
        await answered.getByRole('button', { name: 'Save answer' }).click()
        await saved

        // The server refuses to generate from the snapshot that no longer matches.
        const stale = await page.request.post('/api/edge/tier0', { data: { case_id: caseId, fact_snapshot_id: firstSnapshot } })
        expect(stale.status()).toBe(409)
        expect(((await stale.json()) as { reason?: string }).reason).toBe('facts_unconfirmed')

        await page.goto(dashboard)
        await expect.soft(page.getByText(OUT_OF_DATE).first(), 'the shown evaluation is marked out of date').toBeVisible({ timeout: 60_000 })

        await page.goto(`/app/case/${caseId}/facts?stage=free`)
        await resolveOpenFindings(page, caseId)
        await page.getByRole('button', { name: CONFIRM }).click()
        await page.getByRole('button', { name: 'Get my free evaluation' }).click()
        await page.waitForURL(new RegExp(`${dashboard}$`), { timeout: 180_000 })
        await expectFreeEvaluation(page)
        const snapshots = await snapshotIds(supabase, caseId)
        expect(snapshots, 'a new snapshot for the changed answer').toHaveLength(2)
        const rows = await narrativeRows(supabase, caseId)
        for (const type of NARRATIVE_TYPES) {
          expect(rows.filter((r) => r.narrative_type === type).map((r) => r.fact_snapshot_id), type).toEqual([snapshots[0]])
        }
      })

      await test.step('(f) removing a document after confirmation reopens the facts and marks the evaluation out of date', async () => {
        // The dashboard's remove button calls this route with ?by=document; here the evidence id is used directly.
        const { data: evidence } = await supabase.from('evidence').select('id').eq('case_id', caseId)
        expect(evidence?.length, 'the uploaded statement').toBeGreaterThan(0)
        const [latest] = await snapshotIds(supabase, caseId)
        const removed = await page.request.delete(`/api/evidence/${(evidence as Array<{ id: string }>)[0].id}`)
        expect(removed.status(), await removed.text()).toBe(200)

        await expect
          .poll(async () => {
            const response = await page.request.get(`/api/cases/${caseId}/facts?stage=free`)
            if (response.status() !== 200) return 'checking'
            const view = (await response.json()) as { latestSnapshot?: { unchanged?: boolean } | null }
            return view.latestSnapshot?.unchanged === false ? 'changed' : 'unchanged'
          }, { timeout: 360_000, message: 'the confirmed facts no longer match once the document is gone' })
          .toBe('changed')
        const stale = await page.request.post('/api/edge/tier0', { data: { case_id: caseId, fact_snapshot_id: latest } })
        expect(stale.status()).toBe(409)

        await page.goto(dashboard)
        await expect.soft(page.getByText(OUT_OF_DATE).first(), 'the shown evaluation is marked out of date').toBeVisible({ timeout: 60_000 })
      })

      await test.step('(g) another user cannot read or change this case through any case route', async () => {
        await expectCrossUserDenied(browser, caseId)
      })
    } finally {
      await deleteClerkUser(clerkUserId)
    }
  })
})

test('(g) another user is refused on every case route and learns nothing about the case', async ({ browser }) => {
  await expectCrossUserDenied(browser, fixtures.users.userB.ownedCaseId)
})

async function answeredFindings(supabase: ServiceClient, caseId: string) {
  const { data, error } = await supabase.from('case_fact_findings').select('id').eq('case_id', caseId).is('invalidated_at', null).neq('status', 'open')
  expect(error).toBeNull()
  return data?.length ?? 0
}

async function snapshotIds(supabase: ServiceClient, caseId: string): Promise<string[]> {
  const { data, error } = await supabase.from('case_fact_snapshots').select('id').eq('case_id', caseId).eq('stage', 'free').order('created_at', { ascending: false })
  expect(error).toBeNull()
  return (data ?? []).map((r) => (r as { id: string }).id)
}

async function narrativeRows(supabase: ServiceClient, caseId: string) {
  const { data, error } = await supabase.from('case_narratives').select('narrative_type, fact_snapshot_id').eq('case_id', caseId).in('narrative_type', NARRATIVE_TYPES)
  expect(error).toBeNull()
  return (data ?? []) as Array<{ narrative_type: string; fact_snapshot_id: string | null }>
}

async function expectOneSetOfNarratives(supabase: ServiceClient, caseId: string) {
  const rows = await narrativeRows(supabase, caseId)
  for (const type of NARRATIVE_TYPES) expect(rows.filter((r) => r.narrative_type === type), `one ${type} row`).toHaveLength(1)
}

// User A (a seeded release fixture) against someone else's case: every case-bound route refuses (401, 403 or 404),
// or answers with an empty list, and no response carries the case's content.
async function expectCrossUserDenied(browser: Browser, caseId: string) {
  const context = await browser.newContext({ baseURL, storageState: resolveAuthStatePath(process.cwd(), 'userA') })
  await guardContextAgainstProduction(context)
  await refreshClerkSession(context)
  try {
    const page = await context.newPage()
    await page.goto('/app')
    const bearer = await supabaseToken(page)
    const auth = { authorization: `Bearer ${bearer}` }
    const unknown = '00000000-0000-4000-8000-000000000000'
    const calls: Array<[string, () => Promise<APIResponse>]> = [
      ['GET facts', () => context.request.get(`/api/cases/${caseId}/facts?stage=free`)],
      ['POST snapshot', () => context.request.post(`/api/cases/${caseId}/facts/snapshot`, { data: { stage: 'free' } })],
      ['POST finding', () => context.request.post(`/api/cases/${caseId}/facts/findings/${unknown}`, { data: { resolution: { kind: 'not_sure' } } })],
      ['POST tier0', () => context.request.post('/api/edge/tier0', { data: { case_id: caseId, fact_snapshot_id: unknown } })],
      ['GET free-evaluation pdf', () => context.request.get(`/api/cases/${caseId}/free-evaluation/pdf`)],
      ['GET recommendation', () => context.request.get(`/api/cases/${caseId}/recommendation`)],
      ['GET details', () => context.request.get(`/api/cases/${caseId}/details`)],
      ['GET capabilities', () => context.request.get(`/api/cases/${caseId}/capabilities`)],
      ['GET documents status', () => context.request.get(`/api/cases/${caseId}/documents/status`)],
      ['GET job status', () => context.request.get(`/api/cases/${caseId}/job-status`, { headers: auth })],
      ['PUT responses', () => context.request.put(`/api/cases/${caseId}/responses`, { headers: auth, data: { responses: [{ question_key: 'reported_loss.amount', response_value: '1', response_type: 'number' }] } })],
      ['PATCH status', () => context.request.patch(`/api/cases/${caseId}/status`, { data: { status: 'closed' } })],
      ['GET evidence', () => context.request.get(`/api/cases/${caseId}/evidence`)],
      ['POST evidence process', () => context.request.post(`/api/cases/${caseId}/evidence/process`, { data: { evidenceIds: [unknown] } })],
      ['POST share', () => context.request.post(`/api/cases/${caseId}/share`, { data: { email: 'release-test@example.com' } })],
    ]
    for (const [name, call] of calls) {
      const response = await call()
      const body = await response.text()
      const emptyList = response.status() === 200 && /^\{"items":\[\]\}$/.test(body)
      expect([401, 403, 404].includes(response.status()) || emptyList, `${name}: HTTP ${response.status()} ${body.slice(0, 200)}`).toBe(true)
      expect(response.headers().location, name).toBeUndefined()
      for (const leak of ['Synthetic Bank', 'S$2,400', 'text_content', '"findings"', 'case_summary', 'story_text']) {
        expect(body, `${name} reveals nothing about the case`).not.toContain(leak)
      }
    }
  } finally {
    expectNoProductionTraffic(context)
    await context.close()
  }
}

async function supabaseToken(page: Page): Promise<string> {
  // Clerk loads after the page; on a busy runner the session is not there yet when the page first renders.
  await page.waitForFunction(() => Boolean((globalThis as unknown as { Clerk?: { session?: unknown } }).Clerk?.session), undefined, { timeout: 30_000 })
  const token = await page.evaluate(async () => {
    const clerk = (globalThis as unknown as { Clerk?: { session?: { getToken(o: { template: string }): Promise<string | null> } } }).Clerk
    return clerk?.session?.getToken({ template: 'supabase' }) ?? null
  })
  expect(token, 'user A has a Supabase token').toBeTruthy()
  return token!
}
