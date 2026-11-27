import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assertReadToTheEnd } from '../../supabase/functions/_shared/gemini-finish'

// Elena, 27 Nov 2026: a document not read to the end is a failed reading, so the person is told the file could not be
// read. Before this, a cut-off answer was stored as the document's text and the file showed as read.
const answer = (finishReason?: string) => ({ candidates: [{ finishReason, content: { parts: [{ text: '{"raw_text":"synthetic' }] } }] })

test('only a reading that finished counts', () => {
  assert.doesNotThrow(() => assertReadToTheEnd(answer('STOP')))
  assert.doesNotThrow(() => assertReadToTheEnd(answer(undefined)))
  for (const reason of ['MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER']) {
    assert.throws(() => assertReadToTheEnd(answer(reason)), new RegExp(`document_not_read_to_end: ${reason}`), reason)
  }
})

test('the reading step checks it before the answer is used, and the screen says the file could not be read', () => {
  const fn = readFileSync('supabase/functions/evidence_processed_v2/index.ts', 'utf8')
  const run = fn.slice(fn.indexOf('async function runGemini('), fn.indexOf('// -------------------- Core Worker'))
  assert.ok(run.indexOf('assertReadToTheEnd(j)') > 0 && run.indexOf('assertReadToTheEnd(j)') < run.indexOf('safeParseGeminiJson('))
  const panel = readFileSync('components/state-machine/layer1/evidence-upload-panel.tsx', 'utf8')
  assert.match(panel, /doc\.processing_error \?[\s\S]{0,120}APPROVED\.unreadableFile/)
})
