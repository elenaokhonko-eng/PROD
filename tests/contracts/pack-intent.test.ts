import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { clearPackIntent, parsePackIntent, readPackIntent, savePackIntent } from '../../lib/journey/pack-intent'

// Stage 2 milestone 4: a pack chosen before sign-in (/sign-in?intent=bank) is offered on the dashboard.

function withStorage(run: () => void) {
  const store = new Map<string, string>()
  const previous = (globalThis as { window?: unknown }).window
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  }
  try {
    run()
  } finally {
    ;(globalThis as { window?: unknown }).window = previous
  }
}

test('only bank or fidrec is kept, for a day', () => {
  assert.equal(parsePackIntent('bank'), 'bank')
  assert.equal(parsePackIntent('fidrec'), 'fidrec')
  assert.equal(parsePackIntent('anything'), null)
  withStorage(() => {
    savePackIntent('bank', 1_000)
    assert.equal(readPackIntent(1_000 + 60_000), 'bank')
    assert.equal(readPackIntent(1_000 + 25 * 3_600_000), null, 'expired after a day')
    clearPackIntent()
    assert.equal(readPackIntent(1_000), null)
  })
})

test('storage that throws never breaks the page', () => {
  const previous = (globalThis as { window?: unknown }).window
  ;(globalThis as { window?: unknown }).window = { localStorage: { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } } }
  try {
    savePackIntent('bank')
    assert.equal(readPackIntent(), null)
    clearPackIntent()
  } finally {
    ;(globalThis as { window?: unknown }).window = previous
  }
})

test('sign-in and sign-up remember the intent; the dashboard offers the bank pack before the free evaluation and forgets it at checkout', () => {
  for (const page of ['app/(auth)/sign-in/[[...sign-in]]/page.tsx', 'app/(auth)/sign-up/[[...sign-up]]/page.tsx']) {
    assert.match(readFileSync(page, 'utf8'), /<PackIntentCapture \/>/, page)
  }
  const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')
  assert.match(dashboard, /packIntent === 'bank' &&\s*reportCapability\?\.entitled !== true &&\s*reportCapability\?\.canCheckout === true &&\s*BEFORE_FREE_EVALUATION\.has\(node\)/)
  assert.match(dashboard, /\(productKey === 'self_serve_report' && packIntent === 'bank'\) \|\| \(productKey === 'fidrec_tier2_pack' && packIntent === 'fidrec'\)\) \{\s*clearPackIntent\(\)/)
  // ?intent=fidrec: the route question and the FIDReC pack at the top, before the free evaluation.
  assert.match(dashboard, /packIntent === 'fidrec' && showFidrecOffer && BEFORE_FREE_EVALUATION\.has\(node\)/)
  assert.match(readFileSync('lib/harbor/packs.ts', 'utf8'), /`\/sign-in\?intent=\$\{pack\}`/)
})

// Part B walk-through (25 Nov, PB-17): "not complained yet" left the reason at complaint_not_raised, as before any
// answer, so the route question stayed up and its message never showed; an answer that opened the pack could not be
// changed.
test('the FIDReC route question shows the saved answer and can be changed in every state', () => {
  const offer = readFileSync('components/state-machine/transition/fidrec-offer.tsx', 'utf8')
  assert.match(offer, /const needsAnswer = editing \|\| \(saved === null && props\.reason === 'complaint_not_raised'\)/)
  assert.match(offer, /\{!needsAnswer && \(blocked \|\| saved\) \? \(/)
  assert.match(offer, /onClick=\{startEditing\}>\s*Change my answer/)
  const hook = readFileSync('hooks/state-machine/facts/use-fidrec-route.ts', 'utf8')
  assert.match(hook, /\.in\('question_key', \[\.\.\.ROUTE_KEYS\]\)/)
  const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')
  assert.match(dashboard, /savedRoute=\{fidrecRouteQuery\.isError \? null : fidrecRouteQuery\.data\}/)
  assert.match(dashboard, /await Promise\.all\(\[paymentStatusQuery\.refetch\(\), fidrecRouteQuery\.refetch\(\)\]\)/)
})

// Part B walk-through (25 Nov), PB-19: with a pack chosen, the free evaluation's six questions sat under the pack's
// offer (and under the FIDReC route question), and they flashed after paying until the purchase was visible.
test('with a pack chosen, its offer comes first and the free evaluation waits; nothing flashes after paying', () => {
  const dashboard = readFileSync('app/(case)/app/case/[id]/dashboard/_components/dashboard-client.tsx', 'utf8')
  assert.match(dashboard, /node === 'S1-Journey' && \(showFidrecIntent \|\| showBankIntent\) && !freeEvaluationChosen \? \(/)
  assert.match(dashboard, /onClick=\{\(\) => setFreeEvaluationChosen\(true\)\}>\s*Continue with the free evaluation/)
  // The payment check comes before the free evaluation's steps.
  assert.ok(dashboard.indexOf(') : isAwaitingPaymentConfirmation ? (') < dashboard.indexOf(") : node === 'S1-Journey'"))
  assert.equal(dashboard.split(') : isAwaitingPaymentConfirmation ? (').length - 1, 1)
  assert.match(dashboard, /BEFORE_FREE_EVALUATION\.has\(node\) && !isAwaitingPaymentConfirmation/)
  assert.match(dashboard, /BEFORE_FREE_EVALUATION\.has\(node\) &&\s*paymentReturnProduct === null/)
})

// PB-18: the story box says the pack comes next, and a signed-in person with a case is taken to it once per tab.
test('the story box names the chosen pack, and the case list opens the latest case once', () => {
  const home = readFileSync('app/(marketing)/page.tsx', 'utf8')
  // Above the trust row, which stays directly above the story box (trust-row.test.ts, W1 §B1).
  assert.ok(home.indexOf('<PackIntentNote />') > 0 && home.indexOf('<PackIntentNote />') < home.indexOf('<TrustRow />'))
  const note = readFileSync('components/journey/pack-intent-note.tsx', 'utf8').replace(/\s+/g, ' ')
  assert.ok(note.includes('You chose the {PACK_NAMES[intent]}. Tell us what happened first; your case page offers the pack straight after.'))
  const route = readFileSync('components/journey/pack-intent-route.tsx', 'utf8')
  assert.match(route, /if \(window\.sessionStorage\.getItem\(ROUTED_KEY\)\) return/)
  assert.match(route, /router\.replace\(`\/app\/case\/\$\{caseId\}\/dashboard`\)/)
  assert.match(readFileSync('app/(case)/app/page.tsx', 'utf8'), /<PackIntentRoute caseId=\{cases\?\.\[0\]\?\.id \?\? null\} \/>/)
})
