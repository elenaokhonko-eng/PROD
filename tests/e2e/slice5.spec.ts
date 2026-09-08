import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/harbor-test'
import { readReleaseFixtures } from '../release/release-fixtures'
import {
  cleanupDisposableRecords,
  createDisposableCase,
  createDisposableGapCase,
  createServiceClientFromEnvironment,
  requireUuidScopedEvidencePath,
  type DisposableCleanupScope,
} from './helpers/disposable-records'

const fixtures = readReleaseFixtures()
const readyTimeoutMs = Number(process.env.HARBOR_UPLOAD_READY_TIMEOUT_MS ?? 120_000)

type UploadResponseBody = {
  evidence?: {
    id?: string
    file_path?: string
  }
  error?: string
}

type ProcessResponseBody = {
  ok?: boolean
  results?: Array<{
    evidence_id?: string
    document_id?: string | null
    ok?: boolean
    error?: string | null
  }>
  error?: string
}

test.describe('Slice 5 browser QA', () => {
  test('controlled missing-questions case shows fallback notice', async ({ page }) => {
    const supabase = createServiceClientFromEnvironment()
    const disposable = await createDisposableGapCase(supabase, {
      ownerId: fixtures.users.userA.supabaseUuid,
      summary: 'Disposable Slice 5 missing-questions fallback case',
      includeQuestion: false,
    })

    try {
      await page.goto(`/app/case/${disposable.caseId}/dashboard`)

      await expect(page.getByText('We need a bit more')).toBeVisible()
      await expect(
        page.getByText("We found missing information, but couldn't generate follow-up questions. Please try again."),
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    } finally {
      await cleanupDisposableRecords(supabase, disposable)
    }
  })

  test('upload uses evidence row -> process route -> case document', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-1440', 'Mutating provider checks run once per release SHA.')
    const supabase = createServiceClientFromEnvironment()
    const disposable = await createDisposableCase(supabase, {
      ownerId: fixtures.users.userA.supabaseUuid,
      summary: 'Disposable Slice 5 upload processing case',
    })
    const cleanup: DisposableCleanupScope = { ...disposable }

    try {
      await page.goto(`/app/case/${disposable.caseId}/dashboard`)
      await expect(page.getByText('Upload supporting evidence')).toBeVisible()

      const fileName = `${randomUUID()}-slice5-upload.png`
      const uploadResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/evidence/upload') && response.request().method() === 'POST',
      )
      const processResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/cases/${disposable.caseId}/evidence/process`) &&
          response.request().method() === 'POST',
      )

      await page.locator('input[type="file"]').setInputFiles({
        name: fileName,
        mimeType: 'image/png',
        buffer: tinyPng(),
      })

      const uploadResponse = await uploadResponsePromise
      expect(uploadResponse.ok(), await uploadResponse.text()).toBeTruthy()
      const uploadJson = (await uploadResponse.json()) as UploadResponseBody
      const evidenceId = uploadJson.evidence?.id
      const storagePath = uploadJson.evidence?.file_path
      expect(evidenceId).toBeTruthy()
      expect(storagePath).toBeTruthy()
      cleanup.evidenceIds = [evidenceId!]
      cleanup.storagePaths = [requireUuidScopedEvidencePath(storagePath!, disposable.caseId)]

      const processResponse = await processResponsePromise
      expect(processResponse.ok(), await processResponse.text()).toBeTruthy()
      const processJson = (await processResponse.json()) as ProcessResponseBody
      expect(processJson.ok).toBeTruthy()

      const result = processJson.results?.find((item) => item.evidence_id === evidenceId)
      expect(result?.ok).toBeTruthy()
      expect(result?.document_id).toBeTruthy()
      const documentMutation = await assertSingleCaseDocument(supabase, disposable.caseId, result?.document_id ?? null)
      cleanup.caseDocumentIds = [documentMutation.documentId]
      cleanup.jobIds = documentMutation.jobIds

      await expect(page.getByText(fileName)).toBeVisible()
      await expect(page.getByText('Ready').first()).toBeVisible({ timeout: readyTimeoutMs })
    } finally {
      await cleanupDisposableRecords(supabase, cleanup)
    }
  })

  test('gap answer save sends concrete question_key and typed response_type', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-1440', 'Mutating provider checks run once per release SHA.')
    const supabase = createServiceClientFromEnvironment()
    const disposable = await createDisposableGapCase(supabase, {
      ownerId: fixtures.users.userA.supabaseUuid,
      summary: 'Disposable Slice 5 gap-answer case',
    })
    const cleanup: DisposableCleanupScope = { ...disposable }

    try {
      await page.goto(`/app/case/${disposable.caseId}/dashboard`)
      await expect(page.getByText('A few more details')).toBeVisible()

      await answerFirstVisibleGapQuestion(page)

      const requestPromise = page.waitForRequest(
        (request) =>
          request.url().includes(`/api/cases/${disposable.caseId}/responses`) &&
          request.method() === 'PUT',
      )
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/cases/${disposable.caseId}/responses`) &&
          response.request().method() === 'PUT',
      )
      await page.getByRole('button', { name: 'Save answers' }).click()

      const request = await requestPromise
      const body = request.postDataJSON() as {
        responses?: Array<{
          question_key?: unknown
          response_type?: unknown
          response_value?: unknown
        }>
      }
      const firstResponse = body.responses?.[0]

      expect(firstResponse).toBeDefined()
      expect(typeof firstResponse?.question_key).toBe('string')
      expect(firstResponse?.question_key).not.toBe('')
      expect(firstResponse?.question_key).not.toBe('undefined')
      expect(typeof firstResponse?.response_type).toBe('string')
      expect(firstResponse?.response_type).not.toBe('')
      expect(firstResponse?.response_value).toBeDefined()

      const response = await responsePromise
      expect(response.ok(), await response.text()).toBeTruthy()
      const responseJson = (await response.json()) as { saved?: string[] }
      cleanup.caseResponseIds = responseJson.saved ?? []
    } finally {
      await cleanupDisposableRecords(supabase, cleanup)
    }
  })
})

async function answerFirstVisibleGapQuestion(page: Page) {
  const textInput = page
    .locator('form input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"])')
    .first()
  if ((await textInput.count()) > 0 && (await textInput.isVisible())) {
    await textInput.fill('Slice 5 QA answer')
    return
  }

  const textarea = page.locator('form textarea').first()
  if ((await textarea.count()) > 0 && (await textarea.isVisible())) {
    await textarea.fill('Slice 5 QA answer')
    return
  }

  const radio = page.locator('form [role="radio"]').first()
  if ((await radio.count()) > 0 && (await radio.isVisible())) {
    await radio.click()
    return
  }

  const checkbox = page.locator('form button[role="checkbox"]').first()
  if ((await checkbox.count()) > 0 && (await checkbox.isVisible())) {
    await checkbox.click()
    return
  }

  throw new Error('No supported visible gap-question control found.')
}

async function assertSingleCaseDocument(supabase: SupabaseClient, caseId: string, documentId: string | null) {
  expect(documentId, 'Process response must identify the registered case document').toBeTruthy()

  const { data: documentRow, error } = await supabase
    .from('case_documents')
    .select('id, case_id, storage_bucket, storage_path')
    .eq('id', documentId)
    .single()

  expect(error).toBeNull()
  expect(documentRow?.case_id).toBe(caseId)
  expect(documentRow?.storage_bucket).toBe('evidence')
  expect(documentRow?.storage_path).toBeTruthy()
  requireUuidScopedEvidencePath(documentRow!.storage_path, caseId)

  const { count, error: countError } = await supabase
    .from('case_documents')
    .select('id', { count: 'exact', head: true })
    .eq('storage_bucket', documentRow!.storage_bucket)
    .eq('storage_path', documentRow!.storage_path)

  expect(countError).toBeNull()
  expect(count).toBe(1)

  const { data: jobs, error: jobsError } = await supabase
    .from('jobs')
    .select('id')
    .eq('document_id', documentRow!.id)
  expect(jobsError).toBeNull()

  return {
    documentId: documentRow!.id as string,
    jobIds: (jobs ?? []).map((job) => String(job.id)),
  }
}

function tinyPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  )
}
