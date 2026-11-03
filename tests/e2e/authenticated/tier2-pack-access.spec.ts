import type { Page } from '@playwright/test'
import { expect, expectNoProductionTraffic, guardContextAgainstProduction, test } from '../fixtures/harbor-test'
import { requireEnvironment, resolveAuthStatePath } from '../evidence/run-context'
import { refreshClerkSession, waitForClerkSession } from '../helpers/clerk-session'
import { parseStateCaseFixtures } from '../helpers/state-case-fixtures'
import { readReleaseFixtures } from '../../release/release-fixtures'

// The escalation-pack fixture case is owned by userA.
const caseId = parseStateCaseFixtures(requireEnvironment('HARBOR_STATE_CASES_JSON')).layer3Tier2.caseId
const fixtures = readReleaseFixtures()
const packPaths = [
  `/api/fidrec/tier2/case-pack-json?caseId=${caseId}`,
  `/api/fidrec/tier2/case-pack-export?caseId=${caseId}&format=md`,
]

test.describe('Tier 2 pack access', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-1440', 'API contract checks run once per release SHA.')
  })

  test('the owner loads the pack with the Supabase bearer the app sends and with the session cookie', async ({ page }) => {
    const token = await supabaseToken(page)
    for (const path of packPaths) {
      const response = await page.request.get(path, { headers: { authorization: `Bearer ${token}` }, maxRedirects: 0 })
      expect(response.status(), `${path}: ${await response.text()}`).toBe(200)
    }

    await refreshClerkSession(page.context())
    const cookieOnly = await page.request.get(packPaths[0], { maxRedirects: 0 })
    expect(cookieOnly.status(), await cookieOnly.text()).toBe(200)
    expect(await cookieOnly.json()).toHaveProperty('submission_pack')
  })

  test('another user is refused with 403 or 404 and receives no pack', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: process.env.HARBOR_PREVIEW_BASE_URL,
      storageState: resolveAuthStatePath(process.cwd(), 'userB'),
    })
    await guardContextAgainstProduction(context)
    try {
      const page = await context.newPage()
      const token = await supabaseToken(page)
      for (const path of packPaths) {
        const response = await page.request.get(path, { headers: { authorization: `Bearer ${token}` }, maxRedirects: 0 })
        const body = await response.text()
        expect([403, 404], `${path}: ${body}`).toContain(response.status())
        expect(body).not.toContain('submission_pack')
      }
      await refreshClerkSession(context)
      const cookieOnly = await page.request.get(packPaths[0], { maxRedirects: 0 })
      expect([403, 404], await cookieOnly.text()).toContain(cookieOnly.status())
    } finally {
      try {
        expectNoProductionTraffic(context)
      } finally {
        await context.close()
      }
    }
  })

  test('a bearer whose claim was altered to the owner is rejected', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: process.env.HARBOR_PREVIEW_BASE_URL,
      storageState: resolveAuthStatePath(process.cwd(), 'userB'),
    })
    await guardContextAgainstProduction(context)
    try {
      const page = await context.newPage()
      const [header, payload, signature] = (await supabaseToken(page)).split('.')
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
      claims.supabase_uuid = fixtures.users.userA.supabaseUuid
      const forged = [header, Buffer.from(JSON.stringify(claims)).toString('base64url'), signature].join('.')

      const response = await page.request.get(packPaths[0], {
        headers: { authorization: `Bearer ${forged}` },
        maxRedirects: 0,
      })
      const body = await response.text()
      expect(response.status(), body).toBe(401)
      expect(body).not.toContain('submission_pack')
    } finally {
      try {
        expectNoProductionTraffic(context)
      } finally {
        await context.close()
      }
    }
  })
})

async function supabaseToken(page: Page) {
  await page.goto('/app')
  await waitForClerkSession(page)
  const token = await page.evaluate(async () => {
    const clerk = (globalThis as unknown as {
      Clerk?: { session?: { getToken(options: { template: string }): Promise<string | null> } }
    }).Clerk
    return clerk?.session?.getToken({ template: 'supabase' }) ?? null
  })
  expect(token, 'Clerk Supabase token must be available').toBeTruthy()
  return token!
}
