import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { technicalRecordsExport } from '../../app/api/privacy/export/technical-records'
import { scrubErrorText } from '../../lib/server/safe-error'
import { accountSrfCase } from '../fixtures/fidrec-update/index.ts'

// FIDReC update, Lane 2 (brief v5, 3e): device identifiers and IP addresses are personal data and may be a third
// party's. They are in the data export and are deleted with the case; they never reach analytics, model usage or the
// logs. Synthetic values only.

const read = (path: string) => readFileSync(path, 'utf8')
const access = accountSrfCase.data.facts.access_events!.value
const devices = accountSrfCase.data.facts.device_recognition!.value

test('the export lists the current value of each new fact per case, without quotes or file names', () => {
  const rows = technicalRecordsExport([
    { case_id: 'case-b', fact_key: 'access_events', status: 'resolved', values: [{ value: access, sources: [{ sourceRef: { documentName: 'synthetic.pdf', quotes: ['line'] } }] }], resolution: { kind: 'agreed' }, invalidated_at: null },
    { case_id: 'case-b', fact_key: 'device_recognition', status: 'resolved', values: [{ value: devices.map(({ answer: _a, ...d }) => d), sources: [] }], resolution: { kind: 'value', value: devices }, invalidated_at: null },
    { case_id: 'case-b', fact_key: 'access_events', status: 'resolved', values: [{ value: [] }], resolution: null, invalidated_at: '2025-08-01T00:00:00Z' },
    { case_id: 'case-a', fact_key: 'total_loss', status: 'resolved', values: [{ value: { amount: 1 } }], resolution: null, invalidated_at: null },
  ])
  assert.deepEqual(rows.map((r) => [r.case_id, r.fact_key]), [['case-b', 'access_events'], ['case-b', 'device_recognition']])
  assert.deepEqual(rows[0].values, [access])
  assert.deepEqual(rows[1].resolution, { kind: 'value', value: devices })
  assert.doesNotMatch(JSON.stringify(rows), /synthetic\.pdf|"quotes"/)
})

test('the export route includes the fact tables and the technical-records section', () => {
  const route = read('app/api/privacy/export/route.ts')
  for (const table of ['case_fact_candidates', 'case_fact_findings', 'case_fact_snapshots', 'case_fact_confirmation_events']) {
    assert.match(route, new RegExp(`"${table}"`))
  }
  assert.match(route, /technical_records: technicalRecordsExport\(/)
})

test('the new facts are deleted with the case: every table that holds them cascades from cases', () => {
  const sql = read('supabase/migrations/20261106120000_fact_reconciliation_foundation.sql')
  for (const table of ['case_fact_candidates', 'case_fact_findings', 'case_fact_snapshots', 'case_fact_confirmation_events', 'case_fact_reconcile_runs']) {
    const body = new RegExp(`CREATE TABLE public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? ''
    assert.match(body, /case_id uuid NOT NULL REFERENCES public\.cases\(id\) ON DELETE CASCADE/, table)
  }
})

test('analytics and model metering code never touches the new facts or IP lookups', () => {
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : []))
  const files = [...walk('lib/analytics'), 'lib/server/model-usage.ts', 'supabase/functions/_shared/model-usage.ts']
  for (const file of files) {
    assert.doesNotMatch(read(file), /access_events|card_auth_events|device_recognition|ipLocation|ip-location|deviceRef/, file)
  }
})

test('Lane 2 code writes no fact value to the logs', () => {
  const files = [
    'supabase/functions/_shared/facts/extraction.ts',
    'supabase/functions/_shared/facts/reconcile.ts',
    'supabase/functions/_shared/facts/display.ts',
    'supabase/functions/_shared/facts/keys.ts',
    'lib/server/facts/facts-service.ts',
    'app/api/privacy/export/technical-records.ts',
    'app/(case)/app/case/[id]/facts/_components/device-confirmation.tsx',
    'app/(case)/app/case/[id]/facts/_components/device-answers.ts',
  ]
  for (const file of files) assert.doesNotMatch(read(file), /console\.|logger\.|log\.(?:info|warn|error|debug)\(/, file)
  // The one log in the reconcile run carries the case, the run and a scrubbed error.
  const run = read('lib/server/facts/run-reconcile.ts')
  const logs = run.match(/log\.\w+\([^\r\n]*/g) ?? []
  assert.deepEqual(logs, ['log.error("Fact reconciliation failed", { caseId, runId, error: safeErrorText(error) })'])
  // A scrubbed error keeps no IPv4 address.
  assert.doesNotMatch(scrubErrorText('insert failed for 203.0.113.24'), /203\.0\.113\.24/)
})

test('the export carries the Section 8 facts, the credit bureau reports with who states each', () => {
  const reports = [{ date: '2025-09-10', bureau: 'Example Credit Bureau', source: 'complainant_statement' }]
  const rows = technicalRecordsExport([
    { case_id: 'case-c', fact_key: 'credit_bureau_reports', status: 'resolved', values: [{ value: reports, sources: [{ sourceRef: { documentName: 'synthetic-report.pdf' } }] }], resolution: { kind: 'agreed' }, invalidated_at: null },
    { case_id: 'case-c', fact_key: 'charges_on_disputed_amount', status: 'resolved', values: [{ value: [] }], resolution: null, invalidated_at: null },
    { case_id: 'case-c', fact_key: 'disputed_amount_payment_requests', status: 'resolved', values: [{ value: [] }], resolution: null, invalidated_at: null },
    { case_id: 'case-c', fact_key: 'fidrec_dispute_dates', status: 'resolved', values: [{ value: {} }], resolution: null, invalidated_at: null },
  ])
  assert.deepEqual(rows.map((r) => r.fact_key), ['charges_on_disputed_amount', 'credit_bureau_reports', 'disputed_amount_payment_requests', 'fidrec_dispute_dates'])
  assert.deepEqual(rows[1].values, [reports])
  assert.doesNotMatch(JSON.stringify(rows), /synthetic-report\.pdf/)
})
