// CR-2 (26 Nov 2026): a pack chosen first is paid for before the story, on an empty case the server creates
// (open_pack_case_v1). Nothing is carried in the browser: the pack is in the address, the rest is on the case.

import { PACK_ANCHOR, type PaidPack } from '@/lib/harbor/packs'
import type { ProductKey } from '@/hooks/state-machine/transition/use-create-checkout-session'

export const PACK_PRODUCT = {
  bank: 'self_serve_report',
  fidrec: 'fidrec_tier2_pack',
} as const satisfies Record<PaidPack, ProductKey>

export function parsePack(value: string | null | undefined): PaidPack | null {
  return value === 'bank' || value === 'fidrec' ? value : null
}

export function packPagePath(pack: PaidPack): string {
  return `/app/pack/${pack}`
}

/** Where a pack button leads (/start-pack/<pack>): sign up first, or straight on; Pricing while the packs are off. */
export function packEntryDestination(pack: PaidPack, { live, signedIn }: { live: boolean; signedIn: boolean }): string {
  if (!live) return `/pricing#${PACK_ANCHOR[pack]}`
  return signedIn ? packPagePath(pack) : `/sign-up?redirect_url=${encodeURIComponent(packPagePath(pack))}`
}

/** A case created for a pack that has no story yet. */
export function isAwaitingStory(row: { pack_first_at?: string | null; primary_narrative?: string | null }): boolean {
  return Boolean(row.pack_first_at) && !row.primary_narrative?.trim()
}

/**
 * Where such a case's page goes instead: back from Stripe to My cases, otherwise to the story page. Only the known
 * values are passed on.
 */
export function storylessCaseDestination(params: { checkout?: unknown; product?: unknown }): string {
  const { checkout, product } = params
  const knownProduct = Object.values(PACK_PRODUCT).find((key) => key === product)
  if ((checkout === 'success' || checkout === 'cancel') && knownProduct) {
    return `/app?checkout=${checkout}&product=${knownProduct}`
  }
  return '/app/case/new'
}

const PACK_TITLE: Record<PaidPack, string> = { bank: 'Bank dispute pack', fidrec: 'FIDReC pack' }

type CaseRow = { id: string; pack_first_at?: string | null; primary_narrative?: string | null }

/**
 * Elena, 27 Nov 2026: a person is never charged on an empty case when they already have a real one. Where a pack button
 * takes a signed-in person who has cases with a story: that case if there is one, My cases to choose if there are
 * several. Null: none has a story, so the pack-first step runs.
 */
export function packDestinationForCases(cases: readonly CaseRow[], pack: PaidPack): string | null {
  const storied = cases.filter((c) => c.primary_narrative?.trim())
  if (storied.length === 1) return `/app/case/${storied[0].id}/dashboard?pack=${pack}`
  return storied.length > 1 ? `/app?pack=${pack}` : null
}

/** The line at the top of My cases. Wording awaiting Elena's approval. */
export function myCasesNotice(
  params: { checkout?: unknown; product?: unknown; pack?: unknown },
  awaitingStory: boolean,
): string | null {
  const bought = (Object.keys(PACK_PRODUCT) as PaidPack[]).find((p) => PACK_PRODUCT[p] === params.product)
  // Only while a case waits for its story: a typed address alone cannot claim a payment.
  if (awaitingStory && bought && params.checkout === 'success') {
    return `Payment received for your ${PACK_TITLE[bought]}. Add a new case to tell your story.`
  }
  if (awaitingStory && bought && params.checkout === 'cancel') return 'Payment cancelled. You have not been charged.'
  const wanted = parsePack(typeof params.pack === 'string' ? params.pack : null)
  return wanted ? `Choose the case your ${PACK_TITLE[wanted]} is for, or add a new case.` : null
}
