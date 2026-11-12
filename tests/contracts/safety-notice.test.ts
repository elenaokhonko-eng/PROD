import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { escapeHtml } from '../../lib/html-escape'
import { SAFETY_NOTICE } from '../../lib/safety-notice'

// Elena, 9 Nov: every footer and user-facing email says we never ask for bank logins, PINs or OTPs.
test('the safety notice is in both page footers and every email template', () => {
  assert.equal(SAFETY_NOTICE, 'GuideBuoy will never ask for your bank login, PIN or OTP.')
  assert.match(readFileSync('components/harbor/public-footer.tsx', 'utf8'), /\{SAFETY_NOTICE\}/)
  // Signed-in pages show the same footer (walkthrough, 9 Nov), so the notice comes with it.
  assert.match(readFileSync('components/harbor/case-shell.tsx', 'utf8'), /<PublicFooter whatsApp=\{false\} \/>/)
  assert.match(readFileSync('app/(marketing)/layout.tsx', 'utf8'), /<PublicFooter \/>/)
  const templates = readFileSync('lib/email-templates.tsx', 'utf8')
  const emails = templates.match(/^export const \w+Email\b/gm) ?? []
  assert.ok(emails.length >= 3)
  assert.equal(templates.split('{SAFETY_NOTICE}').length - 1, emails.length, 'one notice per email template')
})

test('user input in internal emails is escaped', () => {
  assert.equal(escapeHtml('<a href="x">O\'Neil & co</a>'), '&lt;a href=&quot;x&quot;&gt;O&#39;Neil &amp; co&lt;/a&gt;')
  const route = readFileSync('app/api/contact-requests/route.ts', 'utf8')
  const html = route.slice(route.indexOf('<h2>New contact request</h2>'), route.indexOf('`,', route.indexOf('<h2>New contact request</h2>')))
  assert.deepEqual(html.match(/\$\{(?!escapeHtml\()/g) ?? [], [], 'every interpolation is escaped')
})

// Elena, 9 Nov: the sign-up consent box also confirms the person is 18 or over, and keeps Clerk's two links.
test('the sign-up consent label adds the age statement and keeps both links', async () => {
  const { CLERK_LOCALIZATION } = await import('../../lib/clerk-localization')
  const label = CLERK_LOCALIZATION.signUp.legalConsent.checkbox.label__termsOfServiceAndPrivacyPolicy
  assert.match(label, /^I am 18 or over and agree to the /)
  assert.match(label, /\{\{ termsOfServiceLink \|\| link\("Terms of Service"\) \}\}/)
  assert.match(label, /\{\{ privacyPolicyLink \|\| link\("Privacy Policy"\) \}\}/)
  assert.match(readFileSync('app/layout.tsx', 'utf8'), /<ClerkProvider localization=\{CLERK_LOCALIZATION\}>/)
})

test('nothing a person types is rendered as HTML (walkthrough L-11, 9 Nov)', () => {
  const hits = execFileSync('git', ['grep', '-l', 'dangerouslySetInnerHTML', '--', 'app', 'components'], { encoding: 'utf8' }).trim().split('\n')
  assert.deepEqual(hits, ['app/layout.tsx'], 'only the fixed start-up script in the root layout')
})
