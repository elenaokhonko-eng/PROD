import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildReport, caseIdFromPath, noteProblem, lastProblem, reportMailto } from '../../lib/report-problem'

// Elena, 7 Nov: "Report a problem" prepares an email with codes and IDs only. All values are synthetic.

test('the report names the page, case, time and the error codes, with the person’s description', () => {
  noteProblem('output_validation_failed', ['check: amount', 'check: date'])
  const body = buildReport({
    description: 'It said it could not prepare my evaluation.',
    pathname: '/app/case/00000000-0000-4000-8000-000000000001/dashboard',
    time: '7/11/2026, 10:00:00 pm',
    userAgent: 'Synthetic browser',
    problem: lastProblem(),
  })
  assert.match(body, /^What happened:\nIt said it could not prepare my evaluation\.\n/)
  assert.match(body, /Case: 00000000-0000-4000-8000-000000000001/)
  assert.match(body, /Error: output_validation_failed, check: amount, check: date/)
  assert.equal(caseIdFromPath('/app/settings'), null)
  assert.match(reportMailto(body), /^mailto:info@guidebuoyai\.sg\?subject=GuideBuoy%20problem%20report&body=What%20happened/)
})

test('the panel is on every signed-in page, and the failed-evaluation card offers it with the failed check names only', () => {
  assert.match(readFileSync('components/harbor/case-shell.tsx', 'utf8'), /<ReportProblem \/>/)
  const card = readFileSync('components/state-machine/facts/confirm-and-evaluate.tsx', 'utf8')
  // One card for the free evaluation and the bank pack (20 Nov 2026), each with its own problem name.
  assert.match(card, /openProblemReport\(reason \?\? copy\.problem, checks\.map\(\(c\) => `check: \$\{c\}`\)\)/)
  assert.match(card, /free: \{[\s\S]*?problem: 'free_evaluation_failed',/)
  assert.match(card, /bank: \{[\s\S]*?problem: 'bank_pack_failed',/)
  const hook = readFileSync('hooks/state-machine/facts/use-generate-free-evaluation.ts', 'utf8')
  assert.match(hook, /\.map\(\(c\) => c\.check\)/, 'only the check names are kept, never the flagged text')
  assert.doesNotMatch(hook, /c\.detail/)
})

test('signed-in header links are not prefetched, so an expiring session cannot raise blocked sign-in redirects (flaky log, 7 Nov)', () => {
  const shell = readFileSync('components/harbor/case-shell.tsx', 'utf8')
  assert.match(shell, /<Link href="\/app" prefetch=\{false\}/)
  assert.match(shell, /<Link href="\/app\/settings" prefetch=\{false\}/)
})

test('the server sends the report to info@ only, for signed-in users, rate-limited, with the account as reply-to (Elena, 8 Nov)', () => {
  const route = readFileSync('app/api/report-problem/route.ts', 'utf8')
  assert.match(route, /const user = await getCurrentUser\(\)\s*if \(!user\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/)
  assert.match(route, /rateLimit\(`\/api\/report-problem:account:\$\{user\.userId\}`, 5, 10 \* 60_000\)/, 'per account')
  assert.match(route, /rateLimit\(keyFrom\(request, "\/api\/report-problem"\), 20, 10 \* 60_000\)/, 'per IP')
  assert.match(route, /if \(!perAccount\.ok \|\| !perIp\.ok\)/)
  assert.match(route, /to: REPORT_EMAIL,/)
  assert.doesNotMatch(route, /\bto: (?!REPORT_EMAIL)/, 'the recipient is fixed, so this is not an email relay')
  assert.match(route, /replyTo: account \?\? undefined/)
  assert.match(route, /escapeHtml\(report\)/)
  const body = buildReport({ description: 'x', pathname: '/app', time: 't', userAgent: 'u', problem: null, account: 'synthetic@example.com' })
  assert.match(body, /\nAccount: synthetic@example\.com$/)
  const panel = readFileSync('components/harbor/report-problem.tsx', 'utf8')
  assert.match(panel, /fetch\('\/api\/report-problem'/)
  assert.match(panel, /status === 'failed' &&[\s\S]*reportMailto\(report\)/, 'the email link is the fallback when sending fails')
})

test('the report carries the description, page, case ID, time, error codes and check names, account and release only (Elena, 8 Nov)', () => {
  const body = buildReport({
    description: 'The page did not respond.',
    pathname: '/app/case/00000000-0000-4000-8000-000000000001/dashboard',
    time: 't',
    userAgent: 'Synthetic browser',
    problem: { code: 'free_evaluation_failed', details: ['check: amount'], at: 'x' },
    account: 'synthetic@example.com',
    release: '0123456789abcdef0123456789abcdef01234567',
  })
  const labels = [...body.matchAll(/^([A-Z][a-z]+(?: [a-z]+)?):/gm)].map((m) => m[1])
  assert.deepEqual(labels, ['What happened', 'Details', 'Page', 'Case', 'Time', 'Error', 'Browser', 'Account', 'Release'])
  assert.match(body, /\nRelease: 0123456789ab$/)
  // The route builds the report from the request fields and the account only: no case content is loaded.
  const route = readFileSync('app/api/report-problem/route.ts', 'utf8')
  assert.doesNotMatch(route, /\.from\(|story|narrative|text_content/)
})

test('staging sends test-run mail to the sink and mail from people testing by hand to the sandbox; production refuses any sink', async () => {
  const { mailSinkCaptures } = await import('../../lib/mail')
  const staging = { MAIL_TRANSPORT: 'sink-test-traffic' }
  // Test runs: a test account as reply-to, reserved example domains, the handshakes.
  assert.equal(mailSinkCaptures('info@guidebuoyai.sg', 'GuideBuoy problem report', 'harbor.release.fresh.1+clerk_test@example.com', staging), true)
  assert.equal(mailSinkCaptures('release-test@example.com', 'anything', undefined, staging), true)
  assert.equal(mailSinkCaptures('inbox@mailtrap.example', `Harbor release handshake ${'a'.repeat(40)}`, undefined, staging), true)
  assert.equal(mailSinkCaptures('inbox@mailtrap.example', 'Harbor preview handshake 1', undefined, staging), true)
  // A person testing staging by hand.
  assert.equal(mailSinkCaptures('info@guidebuoyai.sg', 'GuideBuoy problem report', 'someone@guidebuoyai.sg', staging), false)
  assert.equal(mailSinkCaptures('info@guidebuoyai.sg', 'GuideBuoy problem report', undefined, {}), false)
  assert.equal(mailSinkCaptures('x@guidebuoyai.sg', 'x', undefined, { MAIL_TRANSPORT: 'sink' }), true)
  const check = readFileSync('scripts/check-env-set.ts', 'utf8')
  assert.match(check, /add\(get\("MAIL_TRANSPORT"\)\.startsWith\("sink"\) \? "FAIL" : "PASS", "production mail is not sent to the sink"\)/)
})
