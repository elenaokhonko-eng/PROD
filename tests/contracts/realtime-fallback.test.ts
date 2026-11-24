import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { documentStatusKey, documentsStillProcessing } from '../../hooks/state-machine/layer1/use-case-documents-realtime'

// D7: staging's supabase_realtime publication carried no tables, so no live update ever reached the dashboard and
// a new user's upload stayed on "Processing". Every live hook must also poll while it is waiting.

test('documents poll until every document is ready or failed', () => {
  assert.equal(documentsStillProcessing([{ processing_status: 'pending' }]), true)
  assert.equal(documentsStillProcessing([{ processing_status: 'ready' }, { processing_status: 'extracting' }]), true)
  assert.equal(documentsStillProcessing([{ processing_status: null }]), true)
  assert.equal(documentsStillProcessing([{ processing_status: 'ready' }, { processing_status: 'failed' }]), false)
  assert.equal(documentsStillProcessing([]), false)
})

test('decision and report poll on a paid case until they exist', () => {
  const decision = readFileSync('hooks/state-machine/layer2/use-decision-run-realtime.ts', 'utf8')
  const report = readFileSync('hooks/state-machine/layer2/use-report-realtime.ts', 'utf8')
  assert.match(decision, /refetchInterval: \(query\) => \(options\?\.poll && !query\.state\.data \? PIPELINE_POLL_MS : false\)/)
  assert.match(report, /refetchInterval: \(query\) => \(options\?\.poll && query\.state\.data\?\.status !== 'COMPLETED' \? PIPELINE_POLL_MS : false\)/)
  const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')
  assert.match(dashboard, /useDecisionRunRealtime\(caseId, \{ poll: isReportPaid \}\)/)
  assert.match(dashboard, /useReportRealtime\(caseId, \{ poll: isReportPaid \}\)/)
})

test('the buy button refreshes when the free evaluation or a new validation appears', () => {
  assert.match(readFileSync('hooks/state-machine/facts/use-generate-free-evaluation.ts', 'utf8'), /invalidateQueries\(\{ queryKey: qk\.entitlement\(caseId\) \}\)/)
  assert.match(readFileSync('hooks/state-machine/layer1/use-auto-refire-extract.ts', 'utf8'), /invalidateQueries\(\{ queryKey: qk\.entitlement\(id\) \}\)/)
})

// Gate B review, 24 Nov 2026: after an upload the confirm step kept its old facts (every question answered, button
// enabled) and a new question appeared only when a press was refused. Upload and every document status change now
// refresh the facts, as removing a document already did.
test('uploading or a document changing status refreshes the confirm step facts', () => {
  const facts = /invalidateQueries\(\{ queryKey: \['case', caseId, 'facts'\] \}\)/
  assert.match(readFileSync('hooks/state-machine/layer1/use-upload-evidence.ts', 'utf8'), facts)
  assert.match(readFileSync('hooks/state-machine/layer1/use-delete-evidence.ts', 'utf8'), facts)
  const realtime = readFileSync('hooks/state-machine/layer1/use-case-documents-realtime.ts', 'utf8')
  assert.match(realtime, facts)
  assert.match(realtime, /const statusKey = query\.data \? documentStatusKey\(query\.data\) : null/)
  assert.match(realtime, /if \(firstLoad\) return/, 'the first load of the list refreshes nothing')

  const a = { id: 'doc-a', processing_status: 'pending' }
  const b = { id: 'doc-b', processing_status: 'ready' }
  assert.equal(documentStatusKey([a, b]), documentStatusKey([b, a]), 'order does not matter')
  assert.notEqual(documentStatusKey([a, b]), documentStatusKey([{ ...a, processing_status: 'ready' }, b]), 'a status change does')
  assert.notEqual(documentStatusKey([b]), documentStatusKey([a, b]), 'a new document does')
  assert.equal(documentStatusKey([{ id: 'doc-c', processing_status: null }]), 'doc-c:pending')
})

// 24 Nov 2026 gate run: a press made while the facts reloaded in the background was refused (facts_in_progress).
test('the confirm buttons are disabled while the facts reload', () => {
  const panel = readFileSync('components/state-machine/facts/confirm-facts-panel.tsx', 'utf8')
  assert.match(panel, /const refreshing = facts\.isFetching/)
  assert.match(panel, /disabled=\{!canContinue \|\| confirm\.isPending \|\| refreshing\}/)
  assert.match(panel, /disabled=\{confirm\.isPending \|\| refreshing\}>Continue/)
})
