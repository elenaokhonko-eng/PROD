import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getValidationResponseTypes, STORED_RESPONSE_TYPES, storedResponseType } from '../../lib/validation-gaps'

// Demo 7 Nov: a "money" follow-up answer was rejected by the database and "Save answers" did nothing.

const ANSWER_TYPES = ['text', 'date', 'datetime', 'money', 'number', 'boolean', 'single_choice', 'multi_choice', 'file_upload', 'textarea', 'long_text']

test('the stored answer types are exactly the ones the database constraint allows', () => {
  const schema = readFileSync('supabase/migrations/20260314055326_remote_schema.sql', 'utf8')
  const constraint = /case_responses_response_type_check" CHECK \(\("response_type" = ANY \(ARRAY\[([^\]]+)\]/.exec(schema)
  assert.ok(constraint, 'constraint found')
  const allowed = [...constraint[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual([...STORED_RESPONSE_TYPES].sort(), allowed.sort())
})

test('every question answer type is stored as an allowed type; money and numbers as number', () => {
  for (const type of [...ANSWER_TYPES, 'unknown', '', null, undefined]) {
    assert.ok((STORED_RESPONSE_TYPES as readonly string[]).includes(storedResponseType(type)), String(type))
  }
  assert.equal(storedResponseType('money'), 'number')
  assert.equal(storedResponseType('datetime'), 'date')
  assert.equal(storedResponseType('file_upload'), 'file')
  assert.equal(storedResponseType('single_choice'), 'text')
  assert.deepEqual(getValidationResponseTypes([{ key: 'reported_loss.amount', question: 'Loss amount', field_type: 'money' }]), { 'reported_loss.amount': 'number' })
})

test('the responses API stores the mapped type, and a failed save is shown on the form', () => {
  const route = readFileSync('app/api/cases/[caseId]/responses/route.ts', 'utf8')
  assert.match(route, /const responseType = storedResponseType\(response\.response_type\)/)
  const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')
  assert.match(dashboard, /catch \{\s*noteProblem\('answers_not_saved'\)\s*setGapSaveError\(GAP_SAVE_ERROR\)/)
  assert.match(dashboard, /answersError: validationErrorMessage \?\? gapSaveError \?\? null/)
})

test('a saved follow-up answer fills its required field when nothing else did, and never overrides a found value', async () => {
  const { applyGapAnswers } = await import('../../supabase/functions/_shared/gap-answers.ts')
  const empty = { incident_date: null, reported_loss: { amount: null, currency: null }, case_meta: { institution_name: null } }
  assert.deepEqual(
    applyGapAnswers(structuredClone(empty), { 'reported_loss.amount': '9,600', 'case_meta.institution_name': ' Synthetic Bank ', incident_date: '2026-03-12' }),
    { incident_date: '2026-03-12', reported_loss: { amount: 9600, currency: null }, case_meta: { institution_name: 'Synthetic Bank' } },
  )
  const found = { incident_date: '2026-03-01', reported_loss: { amount: 1200, currency: 'SGD' }, case_meta: { institution_name: 'Found Bank' } }
  assert.deepEqual(applyGapAnswers(structuredClone(found), { 'reported_loss.amount': '9600', 'case_meta.institution_name': 'Other', incident_date: '2026-03-12' }), found)
  assert.equal(applyGapAnswers(structuredClone(empty), { 'reported_loss.amount': 'not sure' }).reported_loss.amount, null)
  const extract = readFileSync('supabase/functions/run_case_extract_v4/index.ts', 'utf8')
  assert.match(extract, /const ej = applyGapAnswers\(applyValidationCompatibilityAndEnforce\(ejRaw, serverFacts, caseData\), answers\);/)
})
