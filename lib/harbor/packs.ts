import { PRODUCT_CATALOGUE } from '@/lib/payments/product-catalogue'
import { START_EVALUATION, STORY_ANCHOR } from '@/lib/harbor/cta'

// Brief W1 §E: the three options as one source for the product cards (Home, Pricing) and the route strip (§D2).

// §E1, word for word.
export const COMPARISON_LINE =
  'The free evaluation shows where you stand. The bank pack is your formal complaint. The FIDReC pack is the full case for escalation. Each is separate; no pack guarantees an outcome.'

// The FIDReC explanation and the approved time-limit sentence, unchanged from the pricing card. §D2 reuses the second
// as helper text on stop 3; §E2 keeps both in the "What is FIDReC?" disclosure.
export const FIDREC_ABOUT =
  'FIDReC is Singapore’s independent dispute resolution centre for consumers and financial institutions; it costs nothing to start.'
export const FIDREC_TIME_LIMIT =
  'Go within 6 months of your bank’s final reply, or 4 weeks after a written complaint the bank hasn’t resolved.'

export type PaidPack = 'bank' | 'fidrec'

// Addendum V §V3 draws this as a badge; the words are Elena's of 14 Nov ("Coming shortly", as in the app). Elena, 17 Nov:
// no sign-up for the packs before they go live; the badge is the whole "coming soon" state.
export const COMING_SHORTLY = 'Coming shortly'

export const PACK_ACTION: Record<PaidPack, string> = {
  bank: 'Prepare my bank complaint',
  fidrec: 'Prepare my FIDReC case',
}

export const PACK_ANCHOR: Record<PaidPack, string> = { bank: 'bank-pack', fidrec: 'fidrec-pack' }

// §E3: when the packs are live a pack link starts sign-in with the pack as the intent; until then it opens the pack's
// card on Pricing, so no link leads to a button that isn't there.
export function packHref(pack: PaidPack, live: boolean): string {
  return live ? `/sign-in?intent=${pack}` : `/pricing#${PACK_ANCHOR[pack]}`
}

export type PackCard = {
  id: string
  name: string
  price: string
  forYouIf: string
  youGet: string
  goodToKnow: string
  paid: PaidPack | null
  action: { label: string; href: string } | null
}

// §E2, the same four parts on every card.
export function packCards(live: boolean): PackCard[] {
  const paidAction = (pack: PaidPack) => (live ? { label: PACK_ACTION[pack], href: packHref(pack, true) } : null)
  return [
    {
      id: 'free-evaluation',
      name: 'Free evaluation',
      price: 'S$0',
      forYouIf: 'you want to know where you stand',
      youGet: 'your facts checked and in order; how the rules may apply; a suggested next step',
      goodToKnow: 'no card needed; you confirm every fact first',
      paid: null,
      action: { label: START_EVALUATION, href: STORY_ANCHOR },
    },
    {
      id: PACK_ANCHOR.bank,
      name: 'Bank dispute pack',
      price: `S$${PRODUCT_CATALOGUE.self_serve_report.amountSgd}`,
      forYouIf: 'you haven’t sent your bank a full written complaint, or aren’t sure yours was complete',
      youGet: 'a concise, formal complaint with your key facts and evidence',
      goodToKnow: 'a separate option',
      paid: 'bank',
      action: paidAction('bank'),
    },
    {
      id: PACK_ANCHOR.fidrec,
      name: 'FIDReC escalation pack',
      price: `S$${PRODUCT_CATALOGUE.fidrec_tier2_pack.amountSgd}`,
      forYouIf: 'your bank has given its final reply and you disagree, or your written complaint is unresolved',
      youGet: 'a comprehensive case pack: every material fact, the arguments on both sides, your evidence index',
      goodToKnow: 'a separate option: no bank pack needed first',
      paid: 'fidrec',
      action: paidAction('fidrec'),
    },
  ]
}

// §D2, word for word. Pack links follow the availability state (§E3).
export type RouteStop = { title: string; line: string; helper?: string; links: { label: string; href: string }[] }

export function routeStops(live: boolean): RouteStop[] {
  const fidrec = { label: 'FIDReC escalation pack', href: packHref('fidrec', live) }
  return [
    {
      title: 'Just happened',
      line: 'Call your bank and ScamShield (1799). File a police report.',
      links: [{ label: 'First 24 hours', href: '/resources' }],
    },
    {
      title: 'Reported to the bank',
      line: 'Send one complete written complaint with your evidence.',
      links: [
        { label: 'Free evaluation', href: '#tell-your-story' },
        { label: 'Bank dispute pack', href: packHref('bank', live) },
      ],
    },
    {
      title: 'Bank gave its final reply',
      line: 'If you disagree, you can take it to FIDReC. Time limits apply.',
      helper: FIDREC_TIME_LIMIT,
      links: [fidrec],
    },
    {
      title: 'At FIDReC',
      line: 'Prepare for mediation and adjudication with a complete case pack.',
      links: [fidrec],
    },
  ]
}

// §E4, Pricing. The GST line is the brief's (Terms 6.2: not registered for GST). The refunds line summarises Terms 6.4;
// approved by Elena on 24 Nov 2026.
export const GST_LINE = 'Prices in Singapore dollars. No GST is added.'
export const REFUNDS_LINE =
  'Paid packs are made for your case on demand, so they aren’t normally refundable once made. If a pack fails, has an error caused by our systems, or you were charged twice, email info@guidebuoyai.sg within 14 days and we’ll put it right or refund you.'
