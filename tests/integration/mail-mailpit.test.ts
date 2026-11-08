import assert from 'node:assert/strict'
import test from 'node:test'

// CI's real SMTP check (Elena, 8 Nov): sendMail delivers through SMTP to the Mailpit container of the contracts job,
// and the message is read back through Mailpit's API. Nothing leaves the CI machine and no Mailtrap allowance is used.
// Runs when MAILPIT_API_URL is set (the CI job sets it); skipped elsewhere.
const api = process.env.MAILPIT_API_URL

test('sendMail delivers a message over SMTP that Mailpit receives', { skip: !api && 'MAILPIT_API_URL not set' }, async () => {
  process.env.SMTP_HOST = '127.0.0.1'
  process.env.SMTP_PORT = '1025'
  process.env.SMTP_SECURE = 'false'
  process.env.SMTP_REQUIRE_TLS = 'false'
  process.env.MAIL_TRANSPORT = ''
  const { sendMail } = await import('../../lib/mail')
  const subject = `GuideBuoy CI mail check ${Date.now()}`
  const info = await sendMail({ to: 'ci-check@guidebuoyai.sg', subject, html: '<p>Synthetic CI message.</p>', replyTo: 'reply@guidebuoyai.sg' })
  assert.ok(info.messageId)
  const found = await fetch(`${api}/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`).then((r) => r.json()) as {
    messages?: Array<{ Subject: string; To: Array<{ Address: string }>; ReplyTo: Array<{ Address: string }> }>
  }
  assert.equal(found.messages?.length, 1)
  assert.equal(found.messages![0].To[0].Address, 'ci-check@guidebuoyai.sg')
  assert.equal(found.messages![0].ReplyTo[0].Address, 'reply@guidebuoyai.sg')
})
