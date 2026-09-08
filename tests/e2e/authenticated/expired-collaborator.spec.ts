import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import {
  expect,
  expectNoProductionTraffic,
  guardContextAgainstProduction,
  test,
} from '../fixtures/harbor-test'
import { requireAuthState } from '../evidence/run-context'
import { readReleaseFixtures } from '../../release/release-fixtures'
import { captureAndCleanupEvidenceMutation } from '../helpers/evidence-mutation-probe'

const rootDir = resolve(__dirname, '..', '..', '..')
const fixtures = readReleaseFixtures()

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-1440', 'Authorization mutation checks run once per release SHA.')
})

test('expired collaborator cannot upload or process evidence', async ({ browser }) => {
  const fileName = `${randomUUID()}-expired-collaborator-release-gate.png`
  const context = await browser.newContext({
    baseURL: process.env.HARBOR_PREVIEW_BASE_URL,
    storageState: requireAuthState(rootDir, 'userB'),
  })
  await guardContextAgainstProduction(context)
  try {
    const upload = await context.request.post('/api/evidence/upload', {
      multipart: {
        caseId: fixtures.collaboration.expiredCaseId,
        category: 'evidence',
        file: {
          name: fileName,
          mimeType: 'image/png',
          buffer: tinyPng(),
        },
      },
      maxRedirects: 0,
    })
    const process = await context.request.post(
      `/api/cases/${fixtures.collaboration.expiredCaseId}/evidence/process`,
      { data: { evidenceIds: [fixtures.collaboration.expiredEvidenceId] }, maxRedirects: 0 },
    )
    const mutation = await captureAndCleanupEvidenceMutation(fixtures.collaboration.expiredCaseId, fileName)

    expect([403, 404], await upload.text()).toContain(upload.status())
    expect(upload.headers().location).toBeUndefined()
    expect([403, 404], await process.text()).toContain(process.status())
    expect(process.headers().location).toBeUndefined()
    expect(mutation.evidenceRowIds, 'Denied upload must not create an evidence row').toEqual([])
    expect(mutation.storagePaths, 'Denied upload must not create a storage object').toEqual([])
  } finally {
    try {
      expectNoProductionTraffic(context)
    } finally {
      await context.close()
    }
  }
})

function tinyPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  )
}
