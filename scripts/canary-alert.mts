// Production canary alert (cutover gate 7): one email saying the canary failed, with the run link only.
import nodemailer from 'nodemailer'

const { SMTP_HOST, SMTP_USER, SMTP_PASS, CANARY_ALERT_EMAIL, RUN_URL } = process.env
if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !CANARY_ALERT_EMAIL) {
  console.error('canary alert: email settings missing; the failed run is the alert')
  process.exit(0)
}
const transport = nodemailer.createTransport({ host: SMTP_HOST, port: 587, requireTLS: true, auth: { user: SMTP_USER, pass: SMTP_PASS } })
await transport.sendMail({
  from: `GuideBuoy canary <${SMTP_USER}>`,
  to: CANARY_ALERT_EMAIL,
  subject: 'GuideBuoy production canary failed',
  text: `The production free-evaluation canary failed or ran over its time budget.\n\nRun: ${RUN_URL}\n`,
})
console.log('canary alert: sent')
