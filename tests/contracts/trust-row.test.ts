import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ACCOUNT_NOTICE } from '../../lib/harbor/cta'

// Brief W1 §B1 and §B2 (Elena, 14 Nov): the trust promises and the notice before sign-up, word for word.

const row = readFileSync('components/harbor/trust-row.tsx', 'utf8')

test('the four trust items are the approved wording', () => {
  assert.match(row, /text: SAFETY_NOTICE_SHORT/)
  assert.match(readFileSync('lib/safety-notice.ts', 'utf8'), /SAFETY_NOTICE_SHORT = "We never ask for your bank login, PIN or OTP\."/)
  assert.match(row, /'Fixed prices\. No success fee\.'/)
  assert.match(row, /'Private to your account\. We never share your case with any bank or authority unless the law requires it\.'/)
  assert.match(row, /Singapore company, UEN \{COMPANY_UEN\}\./)
  assert.match(row, /export const COMPANY_UEN = '202545875C'/)
})

test('the sharing promise matches the Privacy Policy it rests on', () => {
  const privacy = readFileSync('docs/legal/privacy-policy.md', 'utf8')
  assert.match(privacy, /We never share your case with any bank, FIDReC, the police or any other body\./)
  assert.match(privacy, /We may also disclose personal data where the law requires it/)
  assert.match(privacy, /UEN 202545875C/)
})

test('BizFile is a link out in a new tab, never an embedded view', () => {
  assert.match(row, /href=\{BIZFILE_URL\} target="_blank" rel="noopener noreferrer"/)
  assert.doesNotMatch(row, /<iframe/)
})

test('the trust row sits directly above the story box, and the account notice under its button', () => {
  const home = readFileSync('app/(marketing)/page.tsx', 'utf8')
  assert.match(home, /<TrustRow \/>\s*<NarrativeCapture \/>/)
  assert.equal(ACCOUNT_NOTICE, 'Next you\u2019ll create a free account, so your case is saved privately.')
  assert.match(readFileSync('components/landing/narrative-capture.tsx', 'utf8'), /\{ACCOUNT_NOTICE\}/)
})
