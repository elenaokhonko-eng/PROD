import { request as playwrightRequest, type Browser, type BrowserContext } from '@playwright/test'
import {
  expect,
  expectNoProductionTraffic,
  guardContextAgainstProduction,
  test,
} from '../fixtures/harbor-test'
import { resolveAuthStatePath } from '../evidence/run-context'
import { readReleaseFixtures } from '../../release/release-fixtures'

const fixtures = readReleaseFixtures()
const baseURL = process.env.HARBOR_PREVIEW_BASE_URL!

test.describe.serial('Pattern C ownership and internal authorization', () => {
  test('both Clerk sessions expose their seeded supabase_uuid claim', async ({ browser }) => {
    const userA = await createUserContext(browser, 'userA')
    const userB = await createUserContext(browser, 'userB')
    try {
      await expectSupabaseUuid(userA, fixtures.users.userA.supabaseUuid)
      await expectSupabaseUuid(userB, fixtures.users.userB.supabaseUuid)
    } finally {
      await closeUserContexts(userA, userB)
    }
  })

  test('two users can read only their own case through the RLS-backed API', async ({ browser }) => {
    const userA = await createUserContext(browser, 'userA')
    const userB = await createUserContext(browser, 'userB')
    try {
      await expectOwned(userA, fixtures.users.userA.ownedCaseId)
      await expectDenied(userA, fixtures.users.userB.ownedCaseId)
      await expectOwned(userB, fixtures.users.userB.ownedCaseId)
      await expectDenied(userB, fixtures.users.userA.ownedCaseId)
    } finally {
      await closeUserContexts(userA, userB)
    }
  })

  test('a cross-user zero-row write cannot change the owner-visible value', async ({ browser }) => {
    const userA = await createUserContext(browser, 'userA')
    const userB = await createUserContext(browser, 'userB')
    const { protectedCaseId, originalResponseValue } = fixtures.ownership
    try {
      const before = await userA.request.get(`/api/cases/${protectedCaseId}/details`, { maxRedirects: 0 })
      expect(before.status(), await before.text()).toBe(200)
      expect((await before.json()).case_summary).toBe(originalResponseValue)

      const write = await userB.request.put(`/api/cases/${protectedCaseId}/details`, {
        data: { case_summary: 'cross-user write must never persist' },
        maxRedirects: 0,
      })
      expect([403, 404], await write.text()).toContain(write.status())
      expect(write.headers().location).toBeUndefined()

      const after = await userA.request.get(`/api/cases/${protectedCaseId}/details`, { maxRedirects: 0 })
      expect(after.status(), await after.text()).toBe(200)
      expect((await after.json()).case_summary).toBe(originalResponseValue)
    } finally {
      await closeUserContexts(userA, userB)
    }
  })

  test('missing or invalid worker authorization never enters service-role paths', async () => {
    const anonymous = await playwrightRequest.newContext({ baseURL })
    try {
      for (const path of fixtures.serviceRole.protectedPaths) {
        for (const headers of [{}, { 'x-worker-secret': 'invalid-release-gate-secret' }]) {
          const response = await anonymous.post(path, {
            data: requestBodyFor(path),
            headers,
            maxRedirects: 0,
          })
          expect(response.status(), `${path}: ${await response.text()}`).toBe(401)
          expect(response.headers().location).toBeUndefined()
        }
      }
    } finally {
      await anonymous.dispose()
    }
  })
})

async function createUserContext(browser: Browser, user: 'userA' | 'userB') {
  const context = await browser.newContext({
    baseURL,
    storageState: resolveAuthStatePath(process.cwd(), user),
  })
  await guardContextAgainstProduction(context)
  return context
}

async function closeUserContexts(...contexts: BrowserContext[]) {
  try {
    for (const context of contexts) expectNoProductionTraffic(context)
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
}

async function expectSupabaseUuid(context: BrowserContext, expected: string) {
  const page = await context.newPage()
  await page.goto('/app')
  const claim = await page.evaluate(async () => {
    const clerk = (globalThis as unknown as {
      Clerk?: { session?: { getToken(options: { template: string }): Promise<string | null> } }
    }).Clerk
    const token = await clerk?.session?.getToken({ template: 'supabase' })
    if (!token) return null
    const payload = token.split('.')[1]
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    return (JSON.parse(atob(normalized)) as { supabase_uuid?: unknown }).supabase_uuid ?? null
  })
  expect(claim).toBe(expected)
}

async function expectOwned(context: BrowserContext, caseId: string) {
  const response = await context.request.get(`/api/cases/${caseId}/details`, { maxRedirects: 0 })
  expect(response.status(), await response.text()).toBe(200)
}

async function expectDenied(context: BrowserContext, caseId: string) {
  const response = await context.request.get(`/api/cases/${caseId}/details`, { maxRedirects: 0 })
  expect([403, 404], await response.text()).toContain(response.status())
  expect(response.headers().location).toBeUndefined()
}

function requestBodyFor(path: string) {
  if (path.endsWith('/evidence')) return { document_id: '00000000-0000-0000-0000-000000000000' }
  return { case_id: fixtures.users.userA.ownedCaseId }
}
