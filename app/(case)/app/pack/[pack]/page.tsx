import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { loadProductReadiness, productSwitchedOn } from '@/lib/billing/product-readiness'
import { PACK_PRODUCT, packDestinationForCases, parsePack } from '@/lib/journey/pack-case'
import { PRODUCT_CATALOGUE } from '@/lib/payments/product-catalogue'
import { linkNewAccount } from '@/lib/server/current-user'
import { createUserClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { PackFirstClient } from './_components/pack-first-client'

// CR-2, pack first: where a pack button brings a signed-in person, inside the dashboard. The bank pack goes straight to
// Stripe; the FIDReC pack asks its route question first. While the pack is switched off, nothing is created or sold.
export default async function PackFirstPage({
  params,
  searchParams,
}: {
  params: Promise<{ pack: string }>
  searchParams: Promise<{ case?: string }>
}) {
  const pack = parsePack((await params).pack)
  if (!pack) notFound()
  // Requirements 10.1: the case chosen on "My cases" ("new" for a new one), carried in the address.
  const chosenCase = (await searchParams).case ?? null

  // A new account that is not linked yet is linked here, as on My cases.
  const user = (await getCurrentUser()) ?? (await linkNewAccount())
  if (!user) redirect('/sign-in')

  // Only the person's own cases can be bought on. A failed read stops here: it must not lead to a second charge.
  const supabase = await createUserClient()
  const { data: cases, error } = await supabase
    .from('cases')
    .select('id, primary_narrative, pack_first_at')
    .eq('user_id', user.supabaseUuid)
  if (error) throw new Error('The case list could not be loaded.')
  let chosen: { id: string; primary_narrative: string | null } | null = null
  if (chosenCase && chosenCase !== 'new') {
    chosen = (cases ?? []).find((c) => c.id === chosenCase) ?? null
    if (!chosen) redirect('/app')
    const readiness = await loadProductReadiness(createServiceClient(), chosen.id, PACK_PRODUCT[pack])
    // Already has this pack: to the case, with nothing more to pay.
    if (readiness.reason === 'already_purchased') redirect(`/app/case/${chosen.id}/dashboard`)
  }

  // A case with the FIDReC pack shows no bank offer (Elena, 27 Nov), so a bank button must not end on it.
  const storied = (cases ?? []).filter((c) => c.primary_narrative?.trim())
  let bankOfferHidden = false
  if (pack === 'bank' && storied.length === 1) {
    const service = createServiceClient()
    const [fidrec, bank] = await Promise.all([
      loadProductReadiness(service, storied[0].id, 'fidrec_tier2_pack'),
      loadProductReadiness(service, storied[0].id, 'self_serve_report'),
    ])
    bankOfferHidden = fidrec.reason === 'already_purchased' && bank.reason !== 'already_purchased'
  }
  if (!chosenCase) {
    const destination = packDestinationForCases(cases ?? [], pack, { bankOfferHidden })
    if (destination) redirect(destination)
  }

  return (
    <PackFirstClient
      pack={pack}
      chosenCaseId={chosen?.id ?? null}
      continueToStory={chosenCase === 'new' || Boolean(chosen && !chosen.primary_narrative?.trim())}
      available={productSwitchedOn(PACK_PRODUCT[pack])}
      priceLabel={`S$${PRODUCT_CATALOGUE[PACK_PRODUCT[pack]].amountSgd}`}
    />
  )
}
