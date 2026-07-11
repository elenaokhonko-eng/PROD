import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from '@playwright/test'

const authStatePath = resolve(process.env.SLICE5_AUTH_STORAGE_STATE ?? 'tests/e2e/.auth/slice5.json')
const hasAuthState = existsSync(authStatePath)

const controlledCaseId =
  process.env.SLICE5_CONTROLLED_CASE_ID ?? '9eafdc9e-9431-4ba1-ae28-b62fd4da9098'
const uploadCaseId = process.env.SLICE5_UPLOAD_CASE_ID
const gapCaseId = process.env.SLICE5_GAP_CASE_ID
const readyTimeoutMs = Number(process.env.SLICE5_UPLOAD_READY_TIMEOUT_MS ?? 120_000)

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
  test.skip(
    !hasAuthState,
    `Missing authenticated Clerk storage state. Run "pnpm.cmd run test:e2e:auth", sign in as the test case owner, then save ${authStatePath}.`,
  )

  test('controlled missing-questions case shows fallback notice', async ({ page }) => {
    await page.goto(`/app/case/${controlledCaseId}/dashboard`)

    await expect(page.getByText('We need a bit more')).toBeVisible()
    await expect(
      page.getByText("We found missing information, but couldn't generate follow-up questions. Please try again."),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  test('upload uses evidence row -> process route -> case document', async ({ page }) => {
    test.skip(!uploadCaseId, 'Set SLICE5_UPLOAD_CASE_ID to a case currently showing the evidence upload step.')

    await page.goto(`/app/case/${uploadCaseId}/dashboard`)
    await expect(page.getByText('Upload supporting evidence')).toBeVisible()

    const fileName = `slice5-upload-${Date.now()}.png`
    const uploadResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/evidence/upload') && response.request().method() === 'POST',
    )
    const processResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/cases/${uploadCaseId}/evidence/process`) &&
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
    expect(evidenceId).toBeTruthy()

    const processResponse = await processResponsePromise
    expect(processResponse.ok(), await processResponse.text()).toBeTruthy()
    const processJson = (await processResponse.json()) as ProcessResponseBody
    expect(processJson.ok).toBeTruthy()

    const result = processJson.results?.find((item) => item.evidence_id === evidenceId)
    expect(result?.ok).toBeTruthy()
    expect(result?.document_id).toBeTruthy()

    await expect(page.getByText(fileName)).toBeVisible()
    await expect(page.getByText('Ready').first()).toBeVisible({ timeout: readyTimeoutMs })

    await assertSingleCaseDocumentIfConfigured(result?.document_id ?? null)
  })

  test('gap answer save sends concrete question_key and typed response_type', async ({ page }) => {
    test.skip(!gapCaseId, 'Set SLICE5_GAP_CASE_ID to a case currently showing at least one gap question.')

    await page.goto(`/app/case/${gapCaseId}/dashboard`)
    await expect(page.getByText('A few more details')).toBeVisible()

    await answerFirstVisibleGapQuestion(page)

    const requestPromise = page.waitForRequest(
      (request) =>
        request.url().includes(`/api/cases/${gapCaseId}/responses`) &&
        request.method() === 'PUT',
    )
    await page.getByRole('button', { name: 'Save answers' }).click()

    const request = await requestPromise
    const body = request.postDataJSON() as {
      question_key?: unknown
      response_type?: unknown
      response_value?: unknown
    }

    expect(typeof body.question_key).toBe('string')
    expect(body.question_key).not.toBe('')
    expect(body.question_key).not.toBe('undefined')
    expect(typeof body.response_type).toBe('string')
    expect(body.response_type).not.toBe('')
    expect(body.response_value).toBeDefined()
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

async function assertSingleCaseDocumentIfConfigured(documentId: string | null) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!documentId || !supabaseUrl || !serviceKey) return

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: documentRow, error } = await supabase
    .from('case_documents')
    .select('id, storage_bucket, storage_path')
    .eq('id', documentId)
    .single()

  expect(error).toBeNull()
  expect(documentRow?.storage_bucket).toBeTruthy()
  expect(documentRow?.storage_path).toBeTruthy()

  const { count, error: countError } = await supabase
    .from('case_documents')
    .select('id', { count: 'exact', head: true })
    .eq('storage_bucket', documentRow!.storage_bucket)
    .eq('storage_path', documentRow!.storage_path)

  expect(countError).toBeNull()
  expect(count).toBe(1)
}

function tinyPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  )
}
