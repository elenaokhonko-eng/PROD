import assert from 'node:assert/strict'
import test from 'node:test'
import { collectColumnUses, selectColumns } from '../../scripts/check-supabase-columns'

test('collects select, order and filter columns from a .from() chain', () => {
  const { uses } = collectColumnUses(
    'fixture.ts',
    `await supabase.from('case_documents').select('id, case_id, created_at').eq('case_id', id).order('created_at', { ascending: false })`,
  )
  assert.deepEqual(
    uses.map((use) => `${use.table}.${use.column}:${use.via}`),
    [
      'case_documents.id:select',
      'case_documents.case_id:select',
      'case_documents.created_at:select',
      'case_documents.case_id:eq',
      'case_documents.created_at:order',
    ],
  )
})

test('ignores storage, Array and Buffer .from() calls and dynamic table names', () => {
  const { uses } = collectColumnUses(
    'fixture.ts',
    [
      `await supabase.storage.from('evidence').remove(['a'])`,
      `Array.from('abc')`,
      `Buffer.from('abc', 'base64')`,
      `await supabase.from(table).select('id')`,
    ].join('\n'),
  )
  assert.deepEqual(uses, [])
})

test('select parsing strips aliases, casts and JSON paths and skips embedded relations', () => {
  assert.deepEqual(selectColumns('id, owner:user_id, amount::text, metadata->>source, documents(id, filename), *'), {
    columns: ['id', 'user_id', 'amount', 'metadata'],
    nested: 1,
  })
})
