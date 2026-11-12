import { expect, test } from '../fixtures/harbor-test'
import { refreshClerkSession } from '../helpers/clerk-session'

test.describe('external preview handshakes', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-1440', 'Mutating provider checks run once per release SHA.')
  })

  test('SMTP accepts a release-identified message for the controlled test recipient', async ({ page }) => {
    // Elena, 10 Nov: staging keeps no SMTP test inbox. Delivery through the real mail server is checked by the
    // prod-check smoke test instead (docs/release/cutover-checklist.md). The app's own emails on staging still go to
    // the capture sink and are tested there (report-problem.spec.ts).
    test.skip(process.env.HARBOR_STAGING_SMTP_HANDSHAKE === 'off', 'staging has no SMTP test inbox; proved on prod-check')
    const releaseSha = process.env.HARBOR_RELEASE_SHA!
    const recipient = process.env.HARBOR_SMTP_TEST_RECIPIENT!
    await refreshClerkSession(page.context())
    const response = await page.request.post('/api/email/send', {
      data: {
        to: recipient,
        subject: `Harbor release handshake ${releaseSha}`,
        html: `<p>Harbor release handshake <strong>${releaseSha}</strong></p>`,
      },
      maxRedirects: 0,
    })
    expect(response.status(), await response.text()).toBe(200)
    const body = await response.json() as { success?: boolean; messageId?: string }
    expect(body.success).toBe(true)
    expect(body.messageId).toBeTruthy()
    expect(response.headers().location).toBeUndefined()
  })
})
