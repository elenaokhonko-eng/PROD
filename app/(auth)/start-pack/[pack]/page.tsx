import type { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import { paidStagesEnabled } from '@/lib/billing/paid-stages'
import { packEntryDestination, parsePack } from '@/lib/journey/pack-case'

// Every pack button leads here (lib/harbor/packs.ts packHref). It only redirects: a visitor to sign-up, a signed-in
// person into the dashboard, so no pack button lands a signed-in person on the public home page (CR-2).
export const metadata: Metadata = { robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function StartPackPage({ params }: { params: Promise<{ pack: string }> }) {
  const pack = parsePack((await params).pack)
  if (!pack) notFound()
  const { userId } = await auth()
  redirect(packEntryDestination(pack, { live: paidStagesEnabled(), signedIn: Boolean(userId) }))
}
