import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  checkPackEvidence,
  EVIDENCE_ITEMS,
  type EvidenceDocument,
} from '../../supabase/functions/_shared/evidence-minimums'
import { buildEvidenceIndex } from '../../supabase/functions/_shared/facts/fidrec-pack'

// Evidence minimums (Elena, 23 Nov 2026): buying is unchanged; a paid pack is generated only once the documents it
// needs are in. Synthetic document ids and types only.

const doc = (id: string, type: string | null, extra: Partial<EvidenceDocument> = {}): EvidenceDocument => ({
  id,
  verified_document_type: type,
  complainant_item: null,
  processing_status: 'ready',
  ...extra,
})

const STATEMENT = doc('d-statement', 'BANK_ACCOUNT_STATEMENT_SHOWING_TRANSACTIONS')
const POLICE = doc('d-police', 'POLICE_REPORT_OF_FRAUD_SCAM')
const BANK_REPLY = doc('d-reply', 'BANK_DISPUTED_TRANSACTIONS_OFFICIAL_RESPONSE_COPY')

test('the bank pack needs payment proof and a police report; the scam message is suggested only', () => {
  assert.deepEqual(checkPackEvidence('bank', []).missing, ['payment_proof', 'police_report'])
  const ready = checkPackEvidence('bank', [STATEMENT, POLICE])
  assert.equal(ready.ready, true)
  assert.deepEqual(ready.items.map((i) => [i.item, i.required, i.added]), [
    ['payment_proof', true, true],
    ['police_report', true, true],
    ['scam_message', false, false],
  ])
})

test('the FIDReC pack also needs the bank’s written reply or the written complaint', () => {
  assert.deepEqual(checkPackEvidence('fidrec', [STATEMENT, POLICE]).missing, ['bank_reply_or_complaint'])
  assert.equal(checkPackEvidence('fidrec', [STATEMENT, POLICE, BANK_REPLY]).ready, true)
  const complaint = doc('d-complaint', 'TRANSACTIONS_DISPUTE_REPORT_RAISED_WITH_BANK')
  assert.equal(checkPackEvidence('fidrec', [STATEMENT, POLICE, complaint]).ready, true)
})

test('a transaction alert counts as payment proof', () => {
  const alerts = doc('d-alerts', 'SMS_LOG_ALL_TRANSACTION_NOTIFICATIONS')
  assert.equal(checkPackEvidence('bank', [alerts, POLICE]).ready, true)
})

test('a document still being read does not count until it is ready', () => {
  const reading = doc('d-police', 'POLICE_REPORT_OF_FRAUD_SCAM', { processing_status: 'processing' })
  assert.deepEqual(checkPackEvidence('bank', [STATEMENT, reading]).missing, ['police_report'])
})

test('a misread document counts once the customer marks it, and says so', () => {
  const misread = doc('d-misread', 'OTHER', { complainant_item: 'police_report' })
  const check = checkPackEvidence('bank', [STATEMENT, misread])
  assert.equal(check.ready, true)
  const police = check.items.find((i) => i.item === 'police_report')!
  assert.deepEqual([police.documentIds, police.identifiedByComplainant], [['d-misread'], true])
  // Read correctly by the pipeline as well: not described as identified by the complainant.
  const both = checkPackEvidence('bank', [STATEMENT, POLICE, misread]).items.find((i) => i.item === 'police_report')!
  assert.equal(both.identifiedByComplainant, false)
})

test('the FIDReC pack describes a marked document as identified by the complainant', () => {
  const index = buildEvidenceIndex([], [
    { id: 'd-misread', evidenceType: 'OTHER', complainantItem: 'police_report', text: null },
    { id: 'd-police', evidenceType: 'POLICE_REPORT_OF_FRAUD_SCAM', complainantItem: 'police_report', text: null },
  ])
  assert.deepEqual(index.map((e) => e.label), [
    'a document identified by the complainant as a police report',
    'your police report (uploaded)',
  ])
})

test('the database accepts exactly the evidence items the check knows', () => {
  const migration = readFileSync('supabase/migrations/20261124120000_document_complainant_item.sql', 'utf8')
  const allowed = /CHECK \(complainant_item IN \(([^)]*)\)\)/.exec(migration)![1].match(/'([a-z_]+)'/g)!.map((v) => v.slice(1, -1))
  assert.deepEqual(allowed, [...EVIDENCE_ITEMS])
})

test('buying is unchanged: the purchase rules read no documents', () => {
  for (const path of ['lib/billing/product-readiness.ts', 'app/api/payments/create-checkout-session/route.ts']) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /evidence-minimums|checkPackEvidence/, path)
  }
})

for (const product of ['bank', 'fidrec'] as const) {
  test(`the ${product} pack route refuses with evidence_missing before calling the function`, () => {
    const route = readFileSync(`app/api/edge/${product}-pack/route.ts`, 'utf8')
    const check = route.indexOf(`loadPackEvidence(service, caseId, '${product}')`)
    assert.ok(check > 0)
    assert.ok(check < route.indexOf('proxyEdgeFunction({'))
    assert.match(readFileSync('lib/server/billing/pack-evidence.ts', 'utf8'), /reason: "evidence_missing", missing: check\.missing/)
  })

  test(`run_${product}_pack_v1 runs the same check before any model call`, () => {
    const fn = readFileSync(`supabase/functions/run_${product}_pack_v1/index.ts`, 'utf8')
    assert.match(fn, /from "\.\.\/_shared\/evidence-minimums\.ts"/)
    const check = fn.indexOf(`checkPackEvidence("${product}", `)
    assert.ok(check > 0)
    assert.match(fn, /reason: "evidence_missing", missing: evidence\.missing/)
    assert.ok(check < fn.indexOf('chatJson('), 'checked before the model is called')
  })
}

test('the generate screen reads the same check and waits for the documents', () => {
  const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')
  assert.match(dashboard, /checkPackEvidence\('bank', documents\)/)
  assert.match(dashboard, /stage="bank"\s+evidenceReady=\{packEvidence\.bank\.ready\}/)
  assert.match(dashboard, /stage="fidrec"\s+evidenceReady=\{packEvidence\.fidrec\.ready\}/)
  const confirm = readFileSync('components/state-machine/facts/confirm-and-evaluate.tsx', 'utf8')
  assert.match(confirm, /if \(evidenceReady !== false\) generate\.mutate\(id\)/)
  // PB-2 (25 Nov): also disabled while a document uploads or is read.
  assert.match(confirm, /<Button disabled=\{!evidenceReady \|\| documentsInFlight > 0\}/)
})

test('only the case owner can mark a document, and only as a known item', () => {
  const route = readFileSync('app/api/cases/[caseId]/documents/[documentId]/identify/route.ts', 'utf8')
  assert.match(route, /if \(item !== null && !isEvidenceItem\(item\)\)/)
  assert.match(route, /if \(!access\.isOwner\)/)
  assert.match(route, /\.eq\('id', documentId\)\s+\.eq\('case_id', caseId\)/)
})

// Part B walk-through (25 Nov, PB-5): with both packs bought, the case page read as one report shown twice.
test('each pack on the case page is labelled with its name, and the two are separated', () => {
  const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')
  assert.match(dashboard, /<p id="pack-label-fidrec"[^>]*>\s*\{PACK_NAMES\.fidrec\}\s*<\/p>\s*<FidrecPackView/)
  assert.match(dashboard, /<p id="pack-label-bank"[^>]*>\s*\{PACK_NAMES\.bank\}\s*<\/p>/)
  assert.match(dashboard, /className=\{fidrecReport \? 'space-y-3 border-t pt-8' : 'space-y-3'\}/)
  const names = readFileSync('components/state-machine/facts/pack-evidence.tsx', 'utf8')
  assert.match(names, /PACK_NAMES: Record<PackProduct, string> = \{ bank: 'Bank dispute pack', fidrec: 'FIDReC pack' \}/)
})
