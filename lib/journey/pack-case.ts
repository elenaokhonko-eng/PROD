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

// Requirements 10.1 (28 Nov): set on a case bought from "My cases", so the person goes on to the story after paying.
export const CONTINUE_TO_STORY_KEY = 'continue_to_story'

/** From "My cases" reached by a pack button: that pack's payment step for the chosen case, or for a new one. */
export function myCasesPackHref(pack: PaidPack, caseId: string): string {
  return `/app/pack/${pack}?case=${encodeURIComponent(caseId)}`
}

/**
 * Whether a case chosen on "My cases" has nothing to pay for this pack (Elena, 28 Nov): it already has it, or it has
 * the FIDReC pack. A case with the Bank dispute pack can still add the FIDReC pack. A free evaluation is not a pack.
 */
export function nothingToBuy(pack: PaidPack, { bankOwned, fidrecOwned }: { bankOwned: boolean; fidrecOwned: boolean }): boolean {
  return fidrecOwned || (pack === 'bank' && bankOwned)
}

/**
 * Where such a case's page goes instead: back from Stripe to My cases (or on to the story, for a person who came from
 * My cases), otherwise to the story page. Only the known values are passed on.
 */
export function storylessCaseDestination(params: { checkout?: unknown; product?: unknown }, continueToStory = false): string {
  const { checkout, product } = params
  const knownProduct = Object.values(PACK_PRODUCT).find((key) => key === product)
  if ((checkout === 'success' || checkout === 'cancel') && knownProduct) {
    if (checkout === 'success' && continueToStory) return `/app/case/new?checkout=success&product=${knownProduct}`
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
export function packDestinationForCases(
  cases: readonly CaseRow[],
  pack: PaidPack,
  // The one case with a story shows no offer for this pack (it has the FIDReC pack, and the bank pack is asked for).
  { bankOfferHidden = false }: { bankOfferHidden?: boolean } = {},
): string | null {
  const storied = cases.filter((c) => c.primary_narrative?.trim())
  if (storied.length === 1 && !(pack === 'bank' && bankOfferHidden)) return `/app/case/${storied[0].id}/dashboard?pack=${pack}`
  return storied.length ? `/app?pack=${pack}` : null
}

/** The product_code a paid purchase is recorded under (case_purchases). */
export const PURCHASE_PRODUCT_CODE: Record<(typeof PACK_PRODUCT)[PaidPack], string> = {
  self_serve_report: 'self_serve_report',
  fidrec_tier2_pack: 'escalation_pack',
}

/**
 * The line at the top of My cases (wording approved by Elena, 27 Nov 2026). A payment is reported only from the
 * recorded purchase on the case waiting for its story: until the record arrives the page says it is confirming.
 */
export function myCasesNotice(
  params: { checkout?: unknown; product?: unknown; pack?: unknown },
  { awaitingStory, paidProducts }: { awaitingStory: boolean; paidProducts: readonly string[] },
): string | null {
  const bought = (Object.keys(PACK_PRODUCT) as PaidPack[]).find((p) => PACK_PRODUCT[p] === params.product)
  if (bought && (params.checkout === 'success' || params.checkout === 'cancel')) {
    if (!awaitingStory) return null
    const recorded = paidProducts.includes(PURCHASE_PRODUCT_CODE[PACK_PRODUCT[bought]])
    if (params.checkout === 'cancel') return recorded ? null : 'Payment cancelled. You have not been charged.'
    return recorded ? `Payment received for your ${PACK_TITLE[bought]}. Add a new case to tell your story.` : CONFIRMING_PAYMENT
  }
  const wanted = parsePack(typeof params.pack === 'string' ? params.pack : null)
  return wanted ? `Choose the case your ${PACK_TITLE[wanted]} is for, or add a new case.` : null
}

export const CONFIRMING_PAYMENT = 'Confirming your payment'
