import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { documentsStillProcessing } from '../../hooks/state-machine/layer1/use-case-documents-realtime'

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

test('the buy button refreshes when the free draft or a new validation appears', () => {
  assert.match(readFileSync('hooks/state-machine/layer1/use-tier0-auto-fire.ts', 'utf8'), /invalidateQueries\(\{ queryKey: qk\.entitlement\(id\) \}\)/)
  assert.match(readFileSync('hooks/state-machine/layer1/use-auto-refire-extract.ts', 'utf8'), /invalidateQueries\(\{ queryKey: qk\.entitlement\(id\) \}\)/)
})
