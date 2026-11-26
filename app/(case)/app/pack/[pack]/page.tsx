import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { productSwitchedOn } from '@/lib/billing/product-readiness'
import { PACK_PRODUCT, parsePack } from '@/lib/journey/pack-case'
import { PRODUCT_CATALOGUE } from '@/lib/payments/product-catalogue'
import { linkNewAccount } from '@/lib/server/current-user'
import { PackFirstClient } from './_components/pack-first-client'

// CR-2, pack first: where a pack button brings a signed-in person, inside the dashboard. The bank pack goes straight to
// Stripe; the FIDReC pack asks its route question first. While the pack is switched off, nothing is created or sold.
export default async function PackFirstPage({ params }: { params: Promise<{ pack: string }> }) {
  const pack = parsePack((await params).pack)
  if (!pack) notFound()

  // A new account that is not linked yet is linked here, as on My cases.
  const user = (await getCurrentUser()) ?? (await linkNewAccount())
  if (!user) redirect('/sign-in')

  return (
    <PackFirstClient
      pack={pack}
      available={productSwitchedOn(PACK_PRODUCT[pack])}
      priceLabel={`S$${PRODUCT_CATALOGUE[PACK_PRODUCT[pack]].amountSgd}`}
    />
  )
}
