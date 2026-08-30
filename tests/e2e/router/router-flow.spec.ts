import { expect, test, type Page } from '@playwright/test'
import { expectNamedInteractiveControls, expectNoHorizontalOverflow } from '../helpers/page-quality'

const token = 'router_harbor_release_gate'
const narrative =
  'In March I transferred SGD 5,000 after receiving a message that appeared to come from my bank. The bank declined my recovery request.'

const classification = {
  category: 'Scam-related bank transfer',
  summary: 'A spoofed bank message led to a disputed transfer.',
  fi_name: 'Harbor Test Bank',
  distress_signals: false,
}

const questions = [
  { key: 'bank_contacted', question: 'Have you contacted the bank?', type: 'radio', options: ['Yes', 'No'], required: true },
  { key: 'bank_reference', question: 'What reference did the bank provide?', type: 'text', required: true },
]

const assessment = {
  triage_path: 'B',
  srf_eligible: false,
  fidrec_subscriber: true,
  recommended_path: 'fidrec_eligible',
  eligibility_score: 82,
  success_probability: 'high',
  reasoning: ['The financial institution has issued a response.'],
  missing_info: [],
  next_steps: ['Keep the bank response and transaction records.'],
  estimated_timeline: 'Four to six weeks',
  deadline_warning: null,
  bank_contact_days_elapsed: 31,
  is_fidrec_eligible: true,
}

test('typed story persists and survives classify, refresh, back, and forward navigation', async ({ page }) => {
  const api = await installRouterApi(page)
  await page.goto('/router')

  const story = page.getByPlaceholder(/Example: In March 2024/)
  await story.fill(narrative)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/router\/classify$/)
  await expect(page.getByRole('heading', { name: /Analyzing Your Dispute|Analysis Complete/ })).toBeVisible()
  await expect(page).toHaveURL(/\/router\/results$/)
  await expect(page.getByText('You may be eligible to file with FIDReC')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expectNamedInteractiveControls(page)
  expect(api.session.dispute_narrative).toBe(narrative)
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('gb_pending_narrative')))
    .toContain(narrative)

  await page.reload()
  await expect(page.getByText('You may be eligible to file with FIDReC')).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/router\/results$/, { timeout: 10_000 })
})

test('voice story is transcribed and can enter the same router flow', async ({ page }) => {
  await installMockRecorder(page)
  await installRouterApi(page)
  await page.route('**/api/transcribe', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ transcription: narrative }) }),
  )
  await page.goto('/router')

  await page.getByRole('button', { name: 'Record Voice' }).click()
  const recorder = page.locator('.border-dashed button')
  await expect(recorder).toHaveAccessibleName(/record/i)
  await recorder.click()
  await expect(recorder).toHaveAccessibleName(/stop/i)
  await recorder.click()

  await expect(page.getByText('Transcript:')).toBeVisible()
  await expect(page.getByText(narrative)).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/router\/results$/)
})

test('questions route persists required answers before results', async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem('router_session_token', value), token)
  const api = await installRouterApi(page, {
    existing: {
      id: 'questions-session-id',
      session_token: token,
      classification_result: classification,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
  })

  await page.goto('/router/questions')
  await expect(page.getByRole('heading', { name: questions[0].question })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expectNamedInteractiveControls(page)
  await page.getByLabel('Yes').click()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByPlaceholder('Your answer...').fill('BANK-REF-123')
  await page.getByRole('button', { name: 'See Results' }).click()

  await expect(page).toHaveURL(/\/router\/results$/)
  expect(api.session.user_responses).toEqual({ bank_contacted: 'Yes', bank_reference: 'BANK-REF-123' })
})

test('expired anonymous session is replaced before story entry', async ({ page }) => {
  const expiredToken = 'router_expired_release_gate'
  await page.addInitScript((value) => localStorage.setItem('router_session_token', value), expiredToken)
  const api = await installRouterApi(page, {
    existing: {
      id: 'expired-id',
      session_token: expiredToken,
      created_at: '2020-01-01T00:00:00.000Z',
      expires_at: '2020-01-02T00:00:00.000Z',
    },
  })

  await page.goto('/router')

  await expect.poll(() => api.createdSessions).toBe(1)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('router_session_token'))).toBe(token)
  await expect(page.getByText(/Welcome back/)).toHaveCount(0)
})

test('failed session write does not discard an anonymous story', async ({ page }) => {
  const api = await installRouterApi(page)
  await page.goto('/router')
  await page.getByPlaceholder(/Example: In March 2024/).fill(narrative)
  api.failWrites = true

  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/router$/)
  await expect(page.getByPlaceholder(/Example: In March 2024/)).toHaveValue(narrative)
  await expect(page.getByRole('alert')).toContainText(/try again/i)

  api.failWrites = false
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/router\/results$/)
})

type Session = {
  id: string
  session_token: string
  dispute_narrative?: string
  classification_result?: Record<string, unknown> | null
  user_responses?: Record<string, unknown> | null
  eligibility_assessment?: Record<string, unknown> | null
  recommended_path?: string
  created_at: string
  expires_at: string
}

async function installRouterApi(page: Page, options?: { existing?: Session }) {
  const state = {
    session:
      options?.existing ??
      ({
        id: 'harbor-session-id',
        session_token: token,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      } as Session),
    createdSessions: 0,
    failWrites: false,
  }

  await page.route('**/api/analytics/track', (route) =>
    route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }),
  )
  await page.route('**/api/router/classify', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(classification) }),
  )
  await page.route('**/api/router/assess', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(assessment) }),
  )
  await page.route('**/api/router/questions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions }) }),
  )
  await page.route('**/api/router/session**', async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      state.createdSessions += 1
      state.session = {
        id: `harbor-session-${state.createdSessions}`,
        session_token: token,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ session: state.session }) })
      return
    }

    if (request.method() === 'PATCH') {
      if (state.failWrites) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'offline' }) })
        return
      }
      const payload = request.postDataJSON() as { updates: Partial<Session> }
      state.session = { ...state.session, ...payload.updates }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: state.session }) })
      return
    }

    const requestedToken = new URL(request.url()).searchParams.get('token')
    if (requestedToken !== state.session.session_token) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: state.session }) })
  })

  return state
}

async function installMockRecorder(page: Page) {
  await page.addInitScript(() => {
    const track = { stop() {} }
    const stream = { getTracks: () => [track] }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => stream },
    })

    class MockMediaRecorder {
      state = 'inactive'
      stream = stream
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      start() {
        this.state = 'recording'
      }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['harbor voice sample'], { type: 'audio/webm' }) })
        this.onstop?.()
      }
    }

    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: MockMediaRecorder })
  })
}
