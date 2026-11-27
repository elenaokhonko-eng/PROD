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

// Elena, 27 Nov: the payment message depends on the recorded purchase, never on the address alone.
test('My cases reports a payment only from the recorded purchase', () => {
  const bought = { awaitingStory: true, paidProducts: ['self_serve_report'] }
  const nothing = { awaitingStory: true, paidProducts: [] as string[] }
  const success = { checkout: 'success', product: 'self_serve_report' }
  assert.equal(myCasesNotice(success, bought), 'Payment received for your Bank dispute pack. Add a new case to tell your story.')
  assert.equal(myCasesNotice(success, nothing), 'Confirming your payment')
  assert.equal(
    myCasesNotice({ checkout: 'success', product: 'fidrec_tier2_pack' }, { awaitingStory: true, paidProducts: ['escalation_pack'] }),
    'Payment received for your FIDReC pack. Add a new case to tell your story.',
  )
  const cancel = { checkout: 'cancel', product: 'self_serve_report' }
  assert.equal(myCasesNotice(cancel, nothing), 'Payment cancelled. You have not been charged.')
  assert.equal(myCasesNotice(cancel, bought), null, 'never "not charged" when a payment is recorded')
  assert.equal(myCasesNotice({ pack: 'fidrec' }, { awaitingStory: false, paidProducts: [] }), 'Choose the case your FIDReC pack is for, or add a new case.')
  assert.equal(myCasesNotice(success, { awaitingStory: false, paidProducts: [] }), null)
  assert.equal(myCasesNotice({ checkout: 'success', product: 'other' }, bought), null)
  const page = readFileSync('app/(case)/app/page.tsx', 'utf8')
  assert.match(page, /\.from\('case_purchases'\)/)
  assert.match(page, /\.eq\('payment_status', 'paid'\)/)
})

// The gap: a case with the FIDReC pack shows no bank offer, so a bank button must not end there.
test('a bank button for the only case that already has the FIDReC pack goes to My cases', () => {
  assert.equal(packDestinationForCases([storied('a')], 'bank', { bankOfferHidden: true }), '/app?pack=bank')
  assert.equal(packDestinationForCases([storied('a')], 'fidrec', { bankOfferHidden: true }), '/app/case/a/dashboard?pack=fidrec')
  const page = readFileSync('app/(case)/app/pack/[pack]/page.tsx', 'utf8')
  assert.match(page, /bankOfferHidden/)
  assert.match(page, /'fidrec_tier2_pack'/)
})

test('"No saved draft found" says what happened, in the approved words', () => {
  const page = readFileSync('app/(auth)/onboarding/page.tsx', 'utf8')
  assert.ok(page.includes('We couldn’t find a story saved in this browser tab, so no case was started. Add a new case to write your story.'))
  assert.doesNotMatch(page, /Nothing was cleared/)
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
