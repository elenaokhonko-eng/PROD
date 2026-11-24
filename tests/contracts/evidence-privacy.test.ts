import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import test from 'node:test'
import { CASE_DOCUMENT_EXPORT_COLUMNS, caseDocumentsExport } from '../../app/api/privacy/export/case-documents'
import { isMissingTableError, rowsOrEmptyWhenTableMissing } from '../../app/api/privacy/export/optional-table'
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

test('the export lists each uploaded document by name, type and upload date, never its contents or storage path', () => {
  // Only these columns are read: no storage_path, file_url, filename (the stored name) or content.
  assert.deepEqual(CASE_DOCUMENT_EXPORT_COLUMNS.split(', ').sort(), ['case_id', 'document_type', 'original_filename', 'upload_date', 'verified_document_type'])
  const rows = caseDocumentsExport([
    { case_id: 'case-b', original_filename: 'example-statement.pdf', document_type: 'BANK_STATEMENT', verified_document_type: 'BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS', upload_date: '2025-09-20T02:00:00Z' },
    { case_id: 'case-b', original_filename: 'example-credit-report.pdf', document_type: 'CREDIT_BUREAU_REPORT', verified_document_type: null, upload_date: '2025-09-18T02:00:00Z' },
    { case_id: 'case-a', original_filename: 'example-letter.pdf', document_type: null, verified_document_type: null, upload_date: null },
    { original_filename: 'no-case.pdf' },
  ] as never)
  assert.deepEqual(rows, [
    { case_id: 'case-a', file_name: 'example-letter.pdf', document_type: null, uploaded_at: null },
    { case_id: 'case-b', file_name: 'example-credit-report.pdf', document_type: 'CREDIT_BUREAU_REPORT', uploaded_at: '2025-09-18T02:00:00Z' },
    { case_id: 'case-b', file_name: 'example-statement.pdf', document_type: 'BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS', uploaded_at: '2025-09-20T02:00:00Z' },
  ])
  // A row carrying more than was asked for still exports only the four fields.
  const extra = caseDocumentsExport([{ case_id: 'c', original_filename: 'x.pdf', storage_path: 'c/x.pdf', file_url: 'https://example.invalid/x' } as never])
  assert.deepEqual(Object.keys(extra[0]).sort(), ['case_id', 'document_type', 'file_name', 'uploaded_at'])
  assert.doesNotMatch(JSON.stringify(extra), /storage|example\.invalid/)
})

test('the export route lists the case documents and the IP lookups', () => {
  const route = read('app/api/privacy/export/route.ts')
  assert.match(route, /from\("case_documents"\)\.select\(CASE_DOCUMENT_EXPORT_COLUMNS\)/)
  assert.match(route, /case_documents: caseDocumentsExport\(/)
  assert.match(route, /from\("case_ip_locations"\)/)
  assert.doesNotMatch(route, /case_documents_content/)
})

test('document names reach only the person\'s own export: never logs, error text, analytics or model usage', () => {
  // The helper has no logging and is used by the export route alone.
  const helper = read('app/api/privacy/export/case-documents.ts')
  assert.doesNotMatch(helper, /console\.|logger\.|log\.(?:info|warn|error|debug)\(|track|analytics|model_usage|insert|upsert/)
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(join(d, e.name))) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : [])
  const users = [...walk('app'), ...walk('lib'), ...walk('components')]
    .filter((f) => !/case-documents\.ts$/.test(f) && /caseDocumentsExport|privacy\/export\/case-documents/.test(read(f)))
  assert.deepEqual(users.map((f) => f.split(sep).join('/')), ['app/api/privacy/export/route.ts'])
  // The route reads the user's own cases with the user's client, and logs a fixed label and an error code only.
  const route = read('app/api/privacy/export/route.ts')
  assert.match(route, /supabase\.from\("case_documents"\)\.select\(CASE_DOCUMENT_EXPORT_COLUMNS\)\.in\("case_id", ownedCaseIds\)/)
  const logs = route.match(/console\.\w+\([^\r\n]*/g) ?? []
  assert.equal(logs.length, 3)
  for (const line of logs) assert.match(line, /^console\.error\((?:"\[privacy\][^"]*"|`\[privacy\] failed to export \$\{failedQuery\.label\}:`), errorCodeOnly\(\w+(?:\.error)?\)\)$/, line)
  assert.doesNotMatch(route, /safeErrorText|track\(|analytics|\.insert\(|\.upsert\(/)
  // Analytics and model metering code never reads the documents' names.
  for (const file of [...walk('lib/analytics'), 'lib/server/model-usage.ts', 'supabase/functions/_shared/model-usage.ts']) {
    assert.doesNotMatch(read(file), /original_filename|caseDocumentsExport/, file)
  }
})

test('a missing case_ip_locations table exports as no IP lookup records; any other error still fails', () => {
  const missing = [
    { code: '42P01', message: 'relation "public.case_ip_locations" does not exist' },
    { code: 'PGRST205', message: "Could not find the table 'public.case_ip_locations' in the schema cache" },
    { message: 'relation "case_ip_locations" does not exist' },
  ]
  for (const error of missing) {
    assert.equal(isMissingTableError(error), true, JSON.stringify(error))
    assert.deepEqual(rowsOrEmptyWhenTableMissing({ data: null, error }), { data: [], error: null })
  }
  const others = [
    { code: '42501', message: 'permission denied for table case_ip_locations' },
    { code: 'PGRST301', message: 'JWT expired' },
    { code: '57014', message: 'canceling statement due to statement timeout' },
    new Error('fetch failed'),
  ]
  for (const error of others) {
    assert.equal(isMissingTableError(error), false, String((error as { message?: string }).message))
    const result = { data: null, error }
    assert.equal(rowsOrEmptyWhenTableMissing(result), result)
  }
  const ok = { data: [{ case_id: 'c', ip: '192.0.2.1' }], error: null }
  assert.equal(rowsOrEmptyWhenTableMissing(ok), ok)
  // The route applies it to case_ip_locations only, and still fails the export on any error left over.
  const route = read('app/api/privacy/export/route.ts')
  assert.match(route, /from\("case_ip_locations"\)\.select\("\*"\)\.in\("case_id", ownedCaseIds\)\)\.then\(rowsOrEmptyWhenTableMissing\)/)
  assert.equal(route.match(/rowsOrEmptyWhenTableMissing\)/g)?.length, 1)
  assert.match(route, /\{ label: "case IP locations", error: ipLocationsResult\.error \}/)
})
