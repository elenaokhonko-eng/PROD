import { expect, test } from '../fixtures/harbor-test'

test.describe('external preview handshakes', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-1440', 'Mutating provider checks run once per release SHA.')
  })

  test('SMTP accepts a release-identified message for the controlled test recipient', async ({ request }) => {
    const releaseSha = process.env.HARBOR_RELEASE_SHA!
    const recipient = process.env.HARBOR_SMTP_TEST_RECIPIENT!
    const response = await request.post('/api/email/send', {
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
