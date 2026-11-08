import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Hardening item 4 (8 Nov): fixes for what free-evaluation-edge-cases.spec.ts found on staging; that e2e test checks
// the behaviour, these pin the wiring.

test('(e) an evaluation made from facts that changed says so and links back to the facts', () => {
  const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')
  assert.match(dashboard, /const freeFacts = useCaseFacts\(caseId, 'free', \{ enabled: showsEvaluation \}\)/)
  assert.match(dashboard, /freeFactsView\?\.latestSnapshot && !freeFactsView\.latestSnapshot\.unchanged \? `\/app\/case\/\$\{caseId\}\/facts\?stage=free` : null/)
  assert.equal(dashboard.match(/outOfDateHref: evaluationOutOfDateHref,/g)?.length, 2, 'both evaluation views')
  const view = readFileSync('components/state-machine/layer1/tier0-draft-view.tsx', 'utf8')
  assert.match(view, /\{outOfDateHref \? \([\s\S]*Your facts changed since this evaluation\.[\s\S]*href=\{outOfDateHref\}/)
})

test('(f) deleting a document removes its processed document too, so the facts are checked again without it', () => {
  const route = readFileSync('app/api/evidence/[id]/route.ts', 'utf8')
  assert.match(route, /\.from\("evidence"\)\s*\.delete\(\)\s*\.eq\("id", id\)\s*\.select\("id, case_id, file_path"\)/, 'the owner client deletes the evidence first (RLS)')
  assert.match(route, /\.from\("case_documents"\)\s*\.delete\(\)\s*\.eq\("case_id", deletedEvidence\.case_id\)\s*\.eq\("storage_bucket", STORAGE_BUCKET\)\s*\.eq\("storage_path", deletedEvidence\.file_path\)/)
  assert.match(route, /storage\.from\(STORAGE_BUCKET\)\.remove\(\[deletedEvidence\.file_path\]\)/)
  assert.doesNotMatch(route, /error\.message/, 'database errors are not returned to the browser')
})

test('(d) a session that cannot mint its token is signed out, and a signed-out case page goes to sign-in and back', () => {
  const auth = readFileSync('lib/auth.ts', 'utf8')
  assert.match(auth, /try \{\s*token = await getToken\(\{ template: 'supabase' \}\)\s*\} catch \{\s*return null\s*\}/)
  const page = readFileSync('app/(case)/app/case/[id]/dashboard/page.tsx', 'utf8')
  assert.match(page, /if \(!user\) redirect\(`\/sign-in\?redirect_url=\$\{encodeURIComponent\(`\/app\/case\/\$\{caseId\}\/dashboard`\)\}`\)/)
})
