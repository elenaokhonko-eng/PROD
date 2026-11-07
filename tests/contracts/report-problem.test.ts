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
  assert.match(card, /openProblemReport\(reason \?\? 'free_evaluation_failed', checks\.map\(\(c\) => `check: \$\{c\}`\)\)/)
  const hook = readFileSync('hooks/state-machine/facts/use-generate-free-evaluation.ts', 'utf8')
  assert.match(hook, /\.map\(\(c\) => c\.check\)/, 'only the check names are kept, never the flagged text')
  assert.doesNotMatch(hook, /c\.detail/)
})

test('signed-in header links are not prefetched, so an expiring session cannot raise blocked sign-in redirects (flaky log, 7 Nov)', () => {
  const shell = readFileSync('components/harbor/case-shell.tsx', 'utf8')
  assert.match(shell, /<Link href="\/app" prefetch=\{false\}/)
  assert.match(shell, /<Link href="\/app\/settings" prefetch=\{false\}/)
})
