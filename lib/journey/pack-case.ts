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
