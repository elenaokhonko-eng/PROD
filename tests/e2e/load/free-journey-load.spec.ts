import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../fixtures/harbor-test'
import { createServiceClientFromEnvironment } from '../helpers/disposable-records'
import { completeFreeEvaluation, deleteClerkUser, smsPhishingNarrative, startFreshCase } from '../helpers/fresh-account'

// One fresh-account free journey, timed. playwright.load.config.ts runs LOAD_JOURNEYS of them at once and
// scripts/load-report.ts summarises test-results/load/journeys.jsonl (p50/p95). Synthetic content; the Clerk user is
// deleted afterwards.

test.use({ storageState: { cookies: [], origins: [] } })

test('a fresh-account free journey under load', async ({ page }, testInfo) => {
  test.setTimeout(30 * 60_000)
  const supabase = createServiceClientFromEnvironment()
  const started = Date.now()
  const timings: Record<string, number | string | null> = { journeys: Number(process.env.LOAD_JOURNEYS ?? 1), worker: testInfo.workerIndex }

  // Fact check: from the first request for the facts to the first answer that is not "still checking" (202).
  let factsFirstRequest: number | null = null
  let generationStart: number | null = null
  page.on('request', (r) => {
    if (factsFirstRequest === null && r.url().includes('/facts?stage=free') && r.method() === 'GET') factsFirstRequest = Date.now()
    if (r.url().endsWith('/api/edge/tier0') && r.method() === 'POST') generationStart = Date.now()
  })
  page.on('response', async (r) => {
    if (r.url().includes('/facts?stage=free') && r.request().method() === 'GET' && r.status() === 200 && timings.factCheckMs === undefined && factsFirstRequest) {
      timings.factCheckMs = Date.now() - factsFirstRequest
    }
    if (r.url().endsWith('/api/edge/tier0') && r.request().method() === 'POST') {
      timings.generationStatus = r.status()
      timings.generationMs = generationStart ? Date.now() - generationStart : null
      try {
        timings.summarySource = ((await r.json()) as { outputs?: { summary_source?: string } }).outputs?.summary_source ?? null
      } catch {
        timings.summarySource = null
      }
    }
  })

  const { clerkUserId, caseId } = await startFreshCase(page, supabase, smsPhishingNarrative)
  timings.caseCreatedMs = Date.now() - started
  try {
    await completeFreeEvaluation(page, caseId, smsPhishingNarrative)
    timings.totalMs = Date.now() - started
    timings.ok = 'yes'
  } catch (error) {
    timings.ok = 'no'
    timings.error = error instanceof Error ? error.message.split('\n')[0].slice(0, 160) : 'failed'
    throw error
  } finally {
    mkdirSync(join('test-results', 'load'), { recursive: true })
    appendFileSync(join('test-results', 'load', 'journeys.jsonl'), `${JSON.stringify({ at: new Date(started).toISOString(), ...timings })}\n`)
    await deleteClerkUser(clerkUserId)
  }
  expect(timings.ok).toBe('yes')
})
