import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { START_EVALUATION, STORY_ANCHOR } from '../../lib/harbor/cta'
import {
  COMING_SHORTLY,
  COMPARISON_LINE,
  FIDREC_TIME_LIMIT,
  GST_LINE,
  PACK_ACTION,
  REFUNDS_LINE,
  packCards,
  routeStops,
} from '../../lib/harbor/packs'

// Brief W1 §D, §E and Addendum V §V3, V6 (Release 2, Home and Pricing).

const home = readFileSync('app/(marketing)/page.tsx', 'utf8')
const pricing = readFileSync('app/(marketing)/pricing/page.tsx', 'utf8')
const cards = readFileSync('components/harbor/pack-comparison.tsx', 'utf8')
const strip = readFileSync('components/harbor/emergency-strip.tsx', 'utf8')

test('§D1: the emergency strip says what the brief says, with 1799 as a phone link, above the hero', () => {
  assert.match(strip, /Scam happening now\? Call your bank&apos;s fraud hotline first, then ScamShield on\{' '\}/)
  assert.match(strip, /<a href="tel:1799"[^>]*>1799<\/a>\. Come back when your accounts are safe\./)
  assert.match(strip, /<Link href="\/resources"[^>]*>What to do in the first 24 hours<\/Link>/)
  assert.doesNotMatch(strip, /className="[^"]*\b(sticky|fixed)\b/, 'not sticky')
  assert.ok(home.indexOf('<EmergencyStrip />') < home.indexOf('hero-gradient'), 'above the hero')
})

test('§D2: four stops, word for word, stop 3 reusing the approved FIDReC time-limit sentence', () => {
  const stops = routeStops(false)
  assert.deepEqual(
    stops.map((s) => [s.title, s.line]),
    [
      ['Just happened', 'Call your bank and ScamShield (1799). File a police report.'],
      ['Reported to the bank', 'Send one complete written complaint with your evidence.'],
      ['Bank gave its final reply', 'If you disagree, you can take it to FIDReC. Time limits apply.'],
      ['At FIDReC', 'Prepare for mediation and adjudication with a complete case pack.'],
    ],
  )
  assert.equal(stops[2].helper, FIDREC_TIME_LIMIT)
  assert.match(cards, /\{FIDREC_ABOUT\} \{FIDREC_TIME_LIMIT\}/, 'the FIDReC card shows the same sentence')
  assert.match(readFileSync('components/harbor/route-strip.tsx', 'utf8'), /<ol /)
  // Before the story box on desktop, after it on phones: one copy, after the story box, moved up on desktop.
  assert.ok(home.indexOf('<NarrativeCapture />') < home.indexOf('<RouteStrip className="lg:order-first" />'))
  assert.doesNotMatch(home, /id="journey-title"|Tell your story → /, 'Addendum V §V6: the strip replaces the journey sentence')
})

test('§E3: pack links and buttons follow the paid-stages switch', () => {
  const off = routeStops(false).flatMap((s) => s.links)
  assert.deepEqual(off.filter((l) => l.label !== 'First 24 hours' && l.label !== 'Free evaluation').map((l) => l.href), [
    '/pricing#bank-pack',
    '/pricing#fidrec-pack',
    '/pricing#fidrec-pack',
  ])
  const on = routeStops(true).flatMap((s) => s.links)
  assert.deepEqual(on.filter((l) => l.label.endsWith('pack')).map((l) => l.href), [
    '/start-pack/bank',
    '/start-pack/fidrec',
    '/start-pack/fidrec',
  ])

  // Off (Elena, 17 Nov): no button and no sign-up on a paid card; the free card keeps the one start label.
  assert.deepEqual(packCards(false).map((c) => c.action), [{ label: START_EVALUATION, href: STORY_ANCHOR }, null, null])
  assert.deepEqual(packCards(true).map((c) => c.action), [
    { label: START_EVALUATION, href: STORY_ANCHOR },
    { label: PACK_ACTION.bank, href: '/start-pack/bank' },
    { label: PACK_ACTION.fidrec, href: '/start-pack/fidrec' },
  ])
  assert.deepEqual(PACK_ACTION, { bank: 'Prepare my bank complaint', fidrec: 'Prepare my FIDReC case' })
  assert.equal(COMING_SHORTLY, 'Coming shortly')
  assert.match(cards, /card\.paid && !live \?/, 'the badge shows only while the packs are off')
})

test('§E1, §E2: the comparison line and the same four parts on every card', () => {
  assert.equal(
    COMPARISON_LINE,
    'The free evaluation shows where you stand. The bank pack is your formal complaint. The FIDReC pack is the full case for escalation. Each is separate; no pack guarantees an outcome.',
  )
  assert.deepEqual(
    packCards(false).map((c) => [c.name, c.price, c.forYouIf, c.youGet, c.goodToKnow]),
    [
      ['Free evaluation', 'S$0', 'you want to know where you stand', 'your facts checked and in order; how the rules may apply; a suggested next step', 'no card needed; you confirm every fact first'],
      ['Bank dispute pack', 'S$18', 'you haven’t sent your bank a full written complaint, or aren’t sure yours was complete', 'a concise, formal complaint with your key facts and evidence', 'a separate option'],
      ['FIDReC escalation pack', 'S$188', 'your bank has given its final reply and you disagree, or your written complaint is unresolved', 'a comprehensive case pack: every material fact, the arguments on both sides, your evidence index', 'a separate option: no bank pack needed first'],
    ],
  )
  for (const part of ['For you if', 'You get', 'Good to know:']) assert.ok(cards.includes(`>${part}</strong>`), part)
  assert.match(cards, /<summary[^>]*>What is FIDReC\?<\/summary>/)
  assert.match(cards, />Start here</, 'Addendum V §V3')
})

test('§E4: Pricing has the start button in its header, the GST line and a refunds line linked to Terms 6.4', () => {
  assert.match(pricing, /action=\{\s*<>\s*<StartEvaluationButton \/>/)
  assert.equal(GST_LINE, 'Prices in Singapore dollars. No GST is added.')
  assert.match(pricing, /<li>\{GST_LINE\}<\/li>/)
  assert.match(REFUNDS_LINE, /within 14 days/)
  assert.match(pricing, /\{REFUNDS_LINE\}\{' '\}\s*<Link href="\/terms#section-6"[^>]*>Terms, clause 6\.4<\/Link>/)
  assert.doesNotMatch(pricing, /not a law firm/, 'the repeated notice is gone; the What GuideBuoy is block says it')
  assert.match(pricing, /<WhatGuideBuoyIs /)
  assert.doesNotMatch(pricing, /\bintro=/, 'Elena, 18 Nov: no intro; the comparison line says it once')
  assert.match(readFileSync('components/harbor/legal-document.tsx', 'utf8'), /id=\{sectionAnchor\(block\.text\)\}/)
  assert.match(readFileSync('docs/legal/terms-of-service.md', 'utf8'), /^## 6\. /m)
})
