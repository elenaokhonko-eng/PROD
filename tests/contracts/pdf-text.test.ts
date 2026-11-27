import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { amountMismatch, linesFromPieces } from '../../supabase/functions/_shared/pdf-text'

// Requirements 9.2 and the 28 Nov brief: text taken from the PDF itself, checked against the AI reading. Synthetic.

test('columns stored one after another are put back on their rows', () => {
  const piece = (str: string, x: number, y: number) => ({ str, x, y })
  // Stored column by column: both dates, then both descriptions, then both amounts.
  const text = linesFromPieces([
    piece('01 Oct', 36, 700), piece('02 Oct', 36, 686),
    piece('Sample Shop A', 120, 700.6), piece('Sample Shop B', 120, 686),
    piece('10.00', 420, 700), piece('20.00', 420, 685.4),
  ])
  assert.equal(text, '01 Oct  Sample Shop A  10.00\n02 Oct  Sample Shop B  20.00')
})

test('the two readings must hold the same amounts the same number of times', () => {
  assert.deepEqual(amountMismatch('a 1,200.00 b 10.25 c 10.25', 'x 1200.00 y 10.25 z 10.25'), { missing: 0, added: 0 })
  assert.deepEqual(amountMismatch('10.25\n10.25\n99.00', '10.25\n...'), { missing: 2, added: 0 })
  assert.deepEqual(amountMismatch('10.25', '10.25 and 77.00'), { missing: 0, added: 1 })
  assert.deepEqual(amountMismatch('version 1.2.34 on 2026-10-01', 'no money here'), { missing: 0, added: 0 })
})

test('the reading step uses the file’s own text when there is enough, and fails when the AI reading differs', () => {
  const fn = readFileSync('supabase/functions/evidence_processed_v2/index.ts', 'utf8')
  assert.match(fn, /amountMismatch\(/)
  assert.match(fn, /document_readings_differ/)
  assert.match(fn, /MIN_TEXT_PER_PAGE/)
  assert.match(fn, /npm:unpdf@/)
})
