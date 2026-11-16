import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { harmoniseDates, produceSummary, type SnapshotFacts } from '../../lib/facts'
import { appendToStory } from '../../lib/story-text'
import { z } from 'zod'
import { invalidFields, logRefusal } from '../../lib/server/refusal-log'

// Cutover checklist, week one. All texts are synthetic.

test('a recording adds to the typed story, and typing after a recording keeps it', () => {
  assert.equal(appendToStory('', 'Recorded part.'), 'Recorded part.')
  assert.equal(appendToStory('Typed part.', 'Recorded part.'), 'Typed part.\n\nRecorded part.')
  assert.equal(appendToStory('Typed part.  \n', '  Second recording. '), 'Typed part.\n\nSecond recording.')
  assert.equal(appendToStory('Typed part.', '   '), 'Typed part.')
})

test('every date the summary states is written in the facts list form', () => {
  assert.equal(
    harmoniseDates('On 2026-10-03 you got an SMS. On 4/10/2026 you went to the police, and on October 5, 2026 you wrote to the bank.'),
    'On 3 Oct 2026 you got an SMS. On 4 Oct 2026 you went to the police, and on 5 Oct 2026 you wrote to the bank.',
  )
  assert.equal(harmoniseDates('On 6th October 2026 and 7 Oct 2026.'), 'On 6 Oct 2026 and 7 Oct 2026.')
  assert.equal(harmoniseDates('Nothing dated here, only S$3,000.'), 'Nothing dated here, only S$3,000.')
})

test('a refused case start is logged with its reason and field names, never the story (R-02)', () => {
  const story = 'A synthetic story that is far too long. '.repeat(10)
  const parsed = z.object({ narrative: z.string().max(20) }).safeParse({ narrative: story })
  assert.equal(parsed.success, false)
  // The logger keeps its own reference to console.warn, so read what reaches stderr.
  const lines: string[] = []
  const write = process.stderr.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk).trim())
    return true
  }) as typeof process.stderr.write
  try {
    if (!parsed.success) logRefusal('case_start', 'invalid_body', 400, { fields: invalidFields(parsed.error) })
  } finally {
    process.stderr.write = write
  }
  assert.equal(lines.length, 1)
  const entry = JSON.parse(lines[0])
  assert.equal(entry.level, 'warn')
  assert.deepEqual(entry.meta, { route: 'case_start', reason: 'invalid_body', status: 400, fields: ['narrative:too_big'] })
  assert.ok(!lines[0].includes('synthetic story'))
})

test('both routes log every refusal they answer with', () => {
  for (const [file, route] of [
    ['app/api/cases/bootstrap/route.ts', 'case_start'],
    ['app/api/payments/create-checkout-session/route.ts', 'checkout'],
  ] as const) {
    const source = readFileSync(file, 'utf8')
    const refusals = source.match(/status: 4\d\d/g)?.length ?? 0
    const logged = source.match(new RegExp(`logRefusal\\(["']${route}["']`, 'g'))?.length ?? 0
    assert.ok(logged >= refusals, `${file}: ${refusals} refusals, ${logged} logged`)
  }
})

test('an unsigned Stripe webhook gets 400 before any configuration check', async () => {
  const saved = { key: process.env.STRIPE_SECRET_KEY, hook: process.env.STRIPE_WEBHOOK_SECRET }
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_WEBHOOK_SECRET
  try {
    const { POST } = await import('../../app/api/payments/webhook/route')
    const response = await POST(new Request('https://guidebuoyai.sg/api/payments/webhook', { method: 'POST', body: '{}' }) as never)
    assert.equal(response.status, 400)
  } finally {
    if (saved.key !== undefined) process.env.STRIPE_SECRET_KEY = saved.key
    if (saved.hook !== undefined) process.env.STRIPE_WEBHOOK_SECRET = saved.hook
  }
})

test('the delivered model summary uses the one date format', async () => {
  const facts: SnapshotFacts = {
    institution_names: { value: [{ name: 'Synthetic Bank', type: 'bank' }], label: 'confirmed' },
    date_discovered: { value: '2026-10-03', label: 'confirmed' },
  }
  const result = await produceSummary({
    facts,
    options: { secondPerson: true, userFacing: { minWords: 4, maxWords: 200 } },
    generate: async () => 'You found out about the transfers from Synthetic Bank on 2026-10-03.',
  })
  assert.equal(result.source, 'model')
  assert.equal(result.summary, 'You found out about the transfers from Synthetic Bank on 3 Oct 2026.')
})
