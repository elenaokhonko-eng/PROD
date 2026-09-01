import { expect, test, type Page } from '@playwright/test'
import { readHarborAuthMode } from '../config'
import { expectNamedInteractiveControls, expectNoHorizontalOverflow } from '../helpers/page-quality'

const token = 'router_harbor_release_gate'
const narrative =
  'In March I transferred SGD 5,000 after receiving a message that appeared to come from my bank. The bank declined my recovery request.'

const handoffUrlMatches = (url: URL) =>
  url.pathname === '/sign-up' && url.searchParams.get('redirect_url') === '/onboarding'

test('typed story is preserved locally and hands off to sign-up onboarding', async ({ page }) => {
  const api = await installRouterApi(page)
  await page.goto('/router', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { level: 1, name: 'Tell Lumi what happened.' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expectNamedInteractiveControls(page)
  await expect.poll(() => api.createdSessions).toBe(1)

  const capture = page.getByRole('region', { name: 'Tell Lumi what happened — in your own words.' })
  const story = capture.getByRole('textbox', { name: 'Your story' })
  await story.fill(narrative)
  await expect.poll(async () => story.inputValue()).toBe(narrative)
  await capture.getByRole('button', { name: /Start organising/ }).click()

  await expect(page).toHaveURL(handoffUrlMatches)
  expect(api.createdSessions).toBe(1)

  const storedDraft = await page.evaluate(() => sessionStorage.getItem('gb_pending_narrative'))
  expect(storedDraft).toContain(narrative)
})

test('local draft is restored when returning to router', async ({ page }) => {
  await page.addInitScript((savedNarrative) => {
    sessionStorage.setItem('gb_pending_narrative', JSON.stringify({ narrative: savedNarrative }))
  }, narrative)

  await installRouterApi(page)
  await page.goto('/router', { waitUntil: 'domcontentloaded' })

  await expect(page.getByText('Your unfinished story was restored from this device.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Your story' })).toHaveValue(narrative)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('textbox', { name: 'Your story' })).toHaveValue(narrative)
})

test('voice story is transcribed and follows the same auth handoff', async ({ page }, testInfo) => {
  await installMockRecorder(page)
  const api = await installRouterApi(page)
  await page.route('**/api/transcribe', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ transcription: narrative }) }),
  )

  await page.goto('/router', { waitUntil: 'domcontentloaded' })
  await expect.poll(() => api.createdSessions).toBe(1)

  const capture = page.getByRole('region', { name: 'Tell Lumi what happened — in your own words.' })
  const voiceToggle = capture.getByRole('button', { name: 'Record my story' })
  await voiceToggle.click()
  await expect(voiceToggle).toHaveAttribute('aria-pressed', 'true')

  const startRecording = capture.getByRole('button', { name: /Start recording/i })
  await expect(startRecording).toBeVisible()
  await startRecording.click()
  await capture.getByRole('button', { name: 'Stop' }).click()

  await expect(capture.getByRole('textbox', { name: 'Your story' })).toHaveValue(narrative)

  if (readHarborAuthMode(testInfo.config.metadata) === 'credential-withheld') {
    const protectedResponse = await page.goto('/app', { waitUntil: 'domcontentloaded' })
    expect(protectedResponse?.status()).toBe(503)
    expect(new URL(page.url()).pathname).toBe('/app')
    await expect(page.getByText('Authentication is not configured.')).toBeVisible()
    return
  }

  await capture.getByRole('button', { name: /Start organising/ }).click()
  await expect(page).toHaveURL(handoffUrlMatches)

  const storedDraftRaw = await page.evaluate(() => sessionStorage.getItem('gb_pending_narrative'))
  const storedDraft = storedDraftRaw ? (JSON.parse(storedDraftRaw) as { narrative?: string; transcript?: string }) : null
  expect(storedDraft?.narrative).toBe(narrative)
  expect(storedDraft?.transcript).toBe(narrative)
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

  await page.goto('/router', { waitUntil: 'domcontentloaded' })

  await expect.poll(() => api.createdSessions).toBe(1)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('router_session_token'))).toBe(token)
  await expect(page.getByText(/Welcome back/)).toHaveCount(0)
})

test('offline mode blocks auth handoff and keeps the local draft', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
  })

  await installRouterApi(page)
  await page.goto('/router', { waitUntil: 'domcontentloaded' })

  const submit = page.getByRole('button', { name: 'Start organising — free' })
  await expect(page.getByText('You’re offline. Your unfinished story stays on this device and can be submitted after you reconnect.')).toBeVisible()
  await expect(submit).toBeDisabled()

  await page.getByRole('textbox', { name: 'Your story' }).fill(narrative)
  const storedDraft = await page.evaluate(() => sessionStorage.getItem('gb_pending_narrative'))
  expect(storedDraft).toContain(narrative)
})

test('existing classified sessions show catch-up controls and can start fresh', async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem('router_session_token', value), token)
  const api = await installRouterApi(page, {
    existing: {
      id: 'classified-session-id',
      session_token: token,
      classification_result: {
        category: 'Scam-related bank transfer',
        summary: 'A spoofed bank message led to a disputed transfer.',
      },
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    },
  })

  await page.goto('/router', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 2, name: 'Welcome back — your progress is saved' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Continue to results/ })).toHaveAttribute('href', '/router/results')

  await page.getByRole('button', { name: 'Start fresh' }).click()
  await expect.poll(() => api.createdSessions).toBe(1)
  await expect(page.getByRole('heading', { level: 2, name: 'Welcome back — your progress is saved' })).toHaveCount(0)
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
  }

  await page.route('**/api/analytics/track**', (route) =>
    route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }),
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
      const payload = request.postDataJSON() as { updates?: Partial<Session> }
      state.session = { ...state.session, ...(payload.updates ?? {}) }
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

      pause() {
        this.state = 'paused'
      }

      resume() {
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
