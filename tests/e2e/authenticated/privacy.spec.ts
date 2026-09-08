import { resolve } from 'node:path'
import {
  expect,
  expectNoProductionTraffic,
  guardContextAgainstProduction,
  test,
} from '../fixtures/harbor-test'
import { requireAuthState } from '../evidence/run-context'
import { readReleaseFixtures } from '../../release/release-fixtures'
import {
  cleanupDisposableRecords,
  createDisposableCase,
  createServiceClientFromEnvironment,
  type DisposableCleanupScope,
} from '../helpers/disposable-records'

const rootDir = resolve(__dirname, '..', '..', '..')
const fixtures = readReleaseFixtures()

test('data export contains only the disposable deletion-user data', async ({ browser }) => {
  const supabase = createServiceClientFromEnvironment()
  const disposable = await createDisposableCase(supabase, {
    ownerId: fixtures.users.deletionUser.supabaseUuid,
    summary: 'Disposable privacy export release-gate case',
  })
  const context = await browser.newContext({
    baseURL: process.env.HARBOR_PREVIEW_BASE_URL,
    storageState: requireAuthState(rootDir, 'deletionUser'),
  })
  await guardContextAgainstProduction(context)

  try {
    const response = await context.request.post('/api/privacy/export', { maxRedirects: 0 })
    expect(response.headers().location).toBeUndefined()
    expect(response.status(), await response.text()).toBe(200)

    const body = await response.json() as {
      user?: { id?: string }
      cases?: Array<{ id?: string; user_id?: string }>
    }
    expect(body.user?.id).toBe(fixtures.users.deletionUser.supabaseUuid)
    expect(body.cases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: disposable.caseId,
        user_id: fixtures.users.deletionUser.supabaseUuid,
      }),
    ]))
    const serializedBody = JSON.stringify(body)
    expect(serializedBody).not.toContain(fixtures.users.userA.supabaseUuid)
    expect(serializedBody).not.toContain(fixtures.users.userA.ownedCaseId)
    expect(serializedBody).not.toContain(fixtures.users.userB.supabaseUuid)
    expect(serializedBody).not.toContain(fixtures.users.userB.ownedCaseId)
  } finally {
    try {
      expectNoProductionTraffic(context)
    } finally {
      await context.close()
      await cleanupDisposableRecords(supabase, disposable)
    }
  }
})

test('deletion request queues only a disposable authenticated fixture', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-1440', 'Destructive provider checks run once per release SHA.')
  const supabase = createServiceClientFromEnvironment()
  const disposable = await createDisposableCase(supabase, {
    ownerId: fixtures.users.deletionUser.supabaseUuid,
    summary: 'Disposable privacy deletion release-gate case',
  })
  const cleanup: DisposableCleanupScope = { ...disposable }
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
      expect.objectContaining({ id: disposable.caseId }),
    ]))
    const serializedPreflight = JSON.stringify(preflightBody)
    expect(serializedPreflight).not.toContain(fixtures.users.userA.supabaseUuid)
    expect(serializedPreflight).not.toContain(fixtures.users.userA.ownedCaseId)
    expect(serializedPreflight).not.toContain(fixtures.users.userB.supabaseUuid)
    expect(serializedPreflight).not.toContain(fixtures.users.userB.ownedCaseId)

    const response = await context.request.post('/api/privacy/delete-request', { maxRedirects: 0 })
    expect(response.headers().location).toBeUndefined()
    expect(response.status(), await response.text()).toBe(202)
    const body = await response.json() as {
      request?: { id?: string; status?: string; requestedAt?: string }
      message?: string
    }
    expect(body.request?.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(body.request?.status).toBe('queued')
    expect(body.request?.requestedAt).toBeTruthy()
    expect(body.message).toContain('queued')
    cleanup.privacyDeletionRequestIds = [body.request!.id!]
  } finally {
    try {
      expectNoProductionTraffic(context)
    } finally {
      await context.close()
      await cleanupDisposableRecords(supabase, cleanup)
    }
  }
})
