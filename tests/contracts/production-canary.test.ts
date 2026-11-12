import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Cutover gate 7 (8 Nov): the production canary is prepared but inert until CANARY_ENABLED is set at cutover, and it
// deletes everything it created.

test('the canary workflow is inert until enabled, hourly then daily, and alerts on failure', () => {
  const wf = readFileSync('.github/workflows/production-canary.yml', 'utf8')
  assert.match(wf, /if: vars\.CANARY_ENABLED == 'true'/)
  assert.match(wf, /cron: "7 \* \* \* \*"/)
  assert.ok(wf.includes('[ "$today" \\< "${{ vars.CANARY_HOURLY_UNTIL }}" ] || [ "$hour_sg" = "02" ]'), 'hourly until the date, then 02:00 SGT')
  assert.match(wf, /if: failure\(\) && steps\.cadence\.outputs\.run == 'true'/)
  assert.match(wf, /environment: production-canary/)
})

test('the canary marks its account and deletes its files, case, unlinked rows, profile and Clerk user', () => {
  const spec = readFileSync('tests/e2e/canary/free-evaluation-canary.spec.ts', 'utf8')
  assert.match(spec, /guidebuoy-canary\+\$\{Date\.now\(\)\}@guidebuoyai\.sg/)
  assert.match(spec, /public_metadata: \{ canary: true \}/)
  assert.match(spec, /\} finally \{\s*await cleanUp\(clerkUserId!, caseId\)/)
  for (const step of [/storage\.from\('evidence'\)\.remove\(paths\)/, /from\('cases'\)\.delete\(\)/, /from\('analytics_events'\)\.delete\(\)\.eq\('event_data->>case_id', id\)/,
    /from\('edge_request_nonces'\)\.delete\(\)/, /from\('profiles'\)\.delete\(\)/, /clerk\(`\/users\/\$\{clerkUserId\}`, \{ method: 'DELETE' \}\)/]) {
    assert.match(spec, step)
  }
})
