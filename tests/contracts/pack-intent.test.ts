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
