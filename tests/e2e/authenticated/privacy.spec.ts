import { resolve } from 'node:path'
import {
  expect,
  expectNoProductionTraffic,
  guardContextAgainstProduction,
  test,
} from '../fixtures/harbor-test'
import { requireAuthState } from '../evidence/run-context'
import { readReleaseFixtures } from '../../release/release-fixtures'

const rootDir = resolve(__dirname, '..', '..', '..')
const fixtures = readReleaseFixtures()

test('data export contains only the authenticated owner data', async ({ request }) => {
  const response = await request.post('/api/privacy/export', { maxRedirects: 0 })
  expect(response.headers().location).toBeUndefined()
  expect(response.status(), await response.text()).toBe(200)

  const body = await response.json() as {
    user?: { id?: string }
    cases?: Array<{ id?: string; user_id?: string }>
  }
  expect(body.user?.id).toBe(fixtures.users.userA.supabaseUuid)
  expect(body.cases).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: fixtures.users.userA.ownedCaseId,
      user_id: fixtures.users.userA.supabaseUuid,
    }),
  ]))
  expect(JSON.stringify(body)).not.toContain(fixtures.users.userB.supabaseUuid)
  expect(JSON.stringify(body)).not.toContain(fixtures.users.userB.ownedCaseId)
})

test('deletion request anonymizes only a disposable authenticated fixture', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-1440', 'Destructive provider checks run once per release SHA.')
  const context = await browser.newContext({
    baseURL: process.env.HARBOR_PREVIEW_BASE_URL,
    storageState: requireAuthState(rootDir, 'deletionUser'),
  })
  await guardContextAgainstProduction(context)
  try {
    const preflight = await context.request.post('/api/privacy/export', { maxRedirects: 0 })
    expect(preflight.headers().location).toBeUndefined()
    expect(preflight.status(), await preflight.text()).toBe(200)
    const preflightBody = await preflight.json() as {
      user?: { id?: string }
      cases?: Array<{ id?: string }>
    }
    expect(preflightBody.user?.id).toBe(fixtures.users.deletionUser.supabaseUuid)
    expect(preflightBody.cases).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: fixtures.users.deletionUser.ownedCaseId }),
    ]))
    const serializedPreflight = JSON.stringify(preflightBody)
    expect(serializedPreflight).not.toContain(fixtures.users.userA.supabaseUuid)
    expect(serializedPreflight).not.toContain(fixtures.users.userA.ownedCaseId)
    expect(serializedPreflight).not.toContain(fixtures.users.userB.supabaseUuid)
    expect(serializedPreflight).not.toContain(fixtures.users.userB.ownedCaseId)

    const response = await context.request.post('/api/privacy/delete-request', { maxRedirects: 0 })
    expect(response.headers().location).toBeUndefined()
    expect(response.status(), await response.text()).toBe(200)
    const body = await response.json() as { success?: boolean; anonymized_case_ids?: string[] }
    expect(body.success).toBe(true)
    expect(body.anonymized_case_ids).toContain(fixtures.users.deletionUser.ownedCaseId)
    expect(body.anonymized_case_ids).not.toContain(fixtures.users.userA.ownedCaseId)
    expect(body.anonymized_case_ids).not.toContain(fixtures.users.userB.ownedCaseId)
  } finally {
    try {
      expectNoProductionTraffic(context)
    } finally {
      await context.close()
    }
  }
})
