import { expect, test } from '../fixtures/harbor-test'
import { readReleaseFixtures } from '../../release/release-fixtures'
import { captureAndCleanupEvidenceMutation } from '../helpers/evidence-mutation-probe'

const fixtures = readReleaseFixtures()
const configuredStorageLimitBytes = 50 * 1024 * 1024

const invalidFiles = [
  {
    name: 'unsupported MIME and extension',
    fileName: 'release-gate-invalid-type.txt',
    mimeType: 'text/plain',
    buffer: () => Buffer.from('unsupported evidence fixture'),
  },
  {
    name: 'declared MIME does not match magic bytes',
    fileName: 'release-gate-invalid-magic.png',
    mimeType: 'image/png',
    buffer: () => Buffer.from('not a png despite the declared MIME type'),
  },
  {
    name: 'file exceeds the configured storage limit',
    fileName: 'release-gate-oversized.png',
    mimeType: 'image/png',
    buffer: oversizedPng,
  },
] as const

test.describe('evidence upload validation', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-1440', 'Mutation checks run once per release SHA.')
  })

  for (const invalid of invalidFiles) {
    test(`${invalid.name} is rejected before persistence`, async ({ request }) => {
      const response = await request.post('/api/evidence/upload', {
        multipart: {
          caseId: fixtures.evidence.uploadCaseId,
          category: 'evidence',
          file: {
            name: invalid.fileName,
            mimeType: invalid.mimeType,
            buffer: invalid.buffer(),
          },
        },
        maxRedirects: 0,
      })
      const mutation = await captureAndCleanupEvidenceMutation(fixtures.evidence.uploadCaseId, invalid.fileName)

      expect(response.status(), await response.text()).toBeGreaterThanOrEqual(400)
      expect(response.status(), 'Invalid files must be rejected by validation, not fail as a provider error').toBeLessThan(500)
      expect(response.headers().location).toBeUndefined()
      expect(mutation.evidenceRowIds, 'Invalid upload must not create an evidence row').toEqual([])
      expect(mutation.storagePaths, 'Invalid upload must not create a storage object').toEqual([])
    })
  }
})

function oversizedPng() {
  const buffer = Buffer.alloc(configuredStorageLimitBytes + 1)
  buffer.write(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    0,
    'base64',
  )
  return buffer
}
