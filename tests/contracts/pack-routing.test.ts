import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { myCasesNotice, packDestinationForCases } from '../../lib/journey/pack-case'

// Elena, 27 Nov 2026: a person is never charged on an empty case when they already have a real one. Synthetic ids.
const storied = (id: string) => ({ id, primary_narrative: 'Synthetic story.', pack_first_at: null })
const empty = { id: 'waiting', primary_narrative: null, pack_first_at: '2026-11-27T00:00:00Z' }

test('a pack button: no case with a story buys first, one goes to that case, several choose with no payment', () => {
  assert.equal(packDestinationForCases([], 'bank'), null)
  assert.equal(packDestinationForCases([empty], 'bank'), null)
  assert.equal(packDestinationForCases([empty, storied('a')], 'bank'), '/app/case/a/dashboard?pack=bank')
  assert.equal(packDestinationForCases([storied('a'), storied('b')], 'fidrec'), '/app?pack=fidrec')
  const page = readFileSync('app/(case)/app/pack/[pack]/page.tsx', 'utf8')
  assert.match(page, /packDestinationForCases\(/)
  assert.match(page, /\.eq\('user_id', user\.supabaseUuid\)/)
  // The destination is chosen before the client that opens a case and Stripe is rendered.
  assert.ok(page.indexOf('redirect(destination)') < page.indexOf('<PackFirstClient'))
})

test('on the chosen case the pack is offered before its evaluation too, and nowhere starts a payment by itself', () => {
  const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')
  assert.match(dashboard, /const askedPack = parsePack\(searchParams\.get\('pack'\)\)/)
  assert.match(dashboard, /data-asked-pack=\{askedPack\}/)
  assert.doesNotMatch(dashboard, /useEffect\([^)]*askedPack/)
})

test('My cases says when a payment was received or cancelled, and asks which case a pack is for', () => {
  assert.equal(
    myCasesNotice({ checkout: 'success', product: 'self_serve_report' }, true),
    'Payment received for your Bank dispute pack. Add a new case to tell your story.',
  )
  assert.equal(myCasesNotice({ checkout: 'cancel', product: 'fidrec_tier2_pack' }, true), 'Payment cancelled. You have not been charged.')
  assert.equal(myCasesNotice({ pack: 'fidrec' }, false), 'Choose the case your FIDReC pack is for, or add a new case.')
  // A typed address cannot claim a payment when no case is waiting for its story, nor with unknown values.
  assert.equal(myCasesNotice({ checkout: 'success', product: 'self_serve_report' }, false), null)
  assert.equal(myCasesNotice({ checkout: 'success', product: 'other' }, true), null)
  assert.equal(myCasesNotice({}, true), null)
})

test('a story told on the public home page fills the waiting case first; the client sends nothing extra', () => {
  const route = readFileSync('app/api/cases/bootstrap/route.ts', 'utf8')
  assert.doesNotMatch(route, /fill_pack_case: z|if \(fillPackCase\)/)
  assert.match(route, /rpc\('fill_pack_case_v1', story\)/)
  assert.doesNotMatch(readFileSync('components/landing/narrative-capture.tsx', 'utf8'), /fill_pack_case: true/)
})

test('My cases empty-state wording is the approved sentence', () => {
  assert.ok(readFileSync('app/(case)/app/page.tsx', 'utf8').includes('Start with your story. GuideBuoy does not send anything to your bank or any other organisation.'))
})
