import assert from 'node:assert/strict'
import test, { before } from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FidrecOfferProps } from '../../components/state-machine/transition/fidrec-offer'

// Gate run 45631835006 (26 Nov): on the FIDReC route question a chosen answer was lost and Save never enabled. The
// question no longer shows while the saved answer is loading, and the answer being chosen is kept by the dashboard.
// The component is compiled with the classic JSX runtime here, so React is made global before it loads.
type Offer = typeof import('../../components/state-machine/transition/fidrec-offer')
let offer: Offer
before(async () => {
  ;(globalThis as { React?: typeof React }).React = React
  offer = await import('../../components/state-machine/transition/fidrec-offer')
})

const render = (props: Partial<FidrecOfferProps>) => {
  const base: FidrecOfferProps = {
    priceLabel: 'S$188',
    canCheckout: false,
    reason: 'complaint_not_raised',
    opensOn: null,
    onBuy: () => {},
    onSaveRoute: async () => {},
    draft: offer.EMPTY_FIDREC_ROUTE_DRAFT,
    onDraftChange: () => {},
  }
  return renderToStaticMarkup(React.createElement(offer.FidrecOffer, { ...base, ...props }))
}

test('the route question waits for the saved answer, then shows only when there is none', () => {
  const loading = render({ savedRoute: undefined })
  assert.doesNotMatch(loading, /Before the FIDReC pack: where are you with your bank\?/, 'not while the saved answer loads')
  assert.doesNotMatch(loading, /Answer the question above first\./)
  assert.match(render({ savedRoute: null }), /Before the FIDReC pack: where are you with your bank\?/)
  const answered = render({ savedRoute: { route: 'not_complained', date: null } })
  assert.doesNotMatch(answered, /Before the FIDReC pack/)
  assert.match(answered, /Change my answer/)
})

test('the answer being chosen comes from the dashboard, so drawing the offer again keeps it', () => {
  const chosen = render({ savedRoute: null, draft: { route: 'not_complained', date: '', editing: false } })
  assert.match(chosen, /<input[^>]*value="not_complained"[^>]*checked=""|<input[^>]*checked=""[^>]*value="not_complained"/)
  assert.doesNotMatch(chosen, /<button[^>]*disabled=""[^>]*>Save<\/button>/, 'Save is enabled once an answer is chosen')
  const editing = render({
    savedRoute: { route: 'final_reply', date: '2026-11-10' },
    draft: { route: 'final_reply', date: '2026-11-10', editing: true },
  })
  assert.match(editing, /Before the FIDReC pack/, 'changing an answer keeps the question open')
  assert.match(editing, /value="2026-11-10"/)
})
