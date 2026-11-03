import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { CASE_DOCUMENT_SELECT } from '../../lib/types/documents'

const selectedColumns = CASE_DOCUMENT_SELECT.split(',').map((column) => column.trim())

const sqlCheck = readFileSync(new URL('../database/client-columns.test.sql', import.meta.url), 'utf8')
const hookSource = readFileSync(
  new URL('../../hooks/state-machine/layer1/use-case-documents-realtime.ts', import.meta.url),
  'utf8',
)

test('the database check covers exactly the case_documents columns the dashboard selects', () => {
  const block = sqlCheck.match(/unnest\(array\[([\s\S]*?)\]\)/)
  assert.ok(block, 'client-columns.test.sql must list the columns in an array literal')
  const checked = [...block[1].matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1])
  assert.deepEqual([...checked].sort(), [...selectedColumns].sort())
})

test('the dashboard document query selects and orders only real columns', () => {
  assert.ok(!selectedColumns.includes('created_at'))
  assert.match(hookSource, /\.select\(CASE_DOCUMENT_SELECT\)/)
  assert.doesNotMatch(hookSource, /\.order\('created_at'/)
  assert.match(hookSource, /\.order\('upload_date', \{ ascending: false \}\)/, 'newest uploads first')
})
