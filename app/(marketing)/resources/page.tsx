import type { Metadata } from 'next'
import Link from 'next/link'
import { PhoneCall, Siren } from 'lucide-react'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { ResourceDirectory } from '@/components/harbor/resource-directory'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'Singapore complaint resources',
  description: 'Official Singapore scam, Police, banking dispute, FIDReC and personal-data resources gathered for a stressful moment.',
  alternates: { canonical: '/resources' },
}

export default function ResourcesPage() {
  return (
    <MarketingPage
      eyebrow="Official Singapore help"
      title="Start with Right now if the scam just happened."
      intro="GuideBuoy organises links to official sources. The authorities publish the rules and make decisions."
    >
      <MarketingSection>
        <aside className="rounded-2xl border border-destructive/30 bg-harbor-error-tint p-6" aria-labelledby="urgent-title">
          <div className="flex gap-4">
            <Siren className="mt-1 size-6 shrink-0 text-destructive" aria-hidden="true" />
            <div>
              <h2 id="urgent-title" className="text-xl font-semibold">Is anyone in immediate danger?</h2>
              <p className="mt-2 leading-7">Call Police emergency services on <a href="tel:999" className="font-semibold underline">999</a>. For scam support, call the ScamShield Helpline on <a href="tel:1799" className="font-semibold underline">1799</a>.</p>
            </div>
          </div>
        </aside>

        <section className="mt-10" aria-labelledby="directory-title">
          <h2 id="directory-title" className="text-3xl font-semibold text-harbor-deep">External information and reporting</h2>
          <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
            Links open websites operated by the named organisations. GuideBuoy is not affiliated with or endorsed by them.
          </p>
          <div className="mt-6"><ResourceDirectory /></div>
          <div className="mt-6 flex flex-wrap gap-4 rounded-card border bg-card p-4 text-sm">
            <span className="inline-flex items-center gap-2 font-semibold"><PhoneCall className="size-4" aria-hidden="true" /> Useful numbers</span>
            <a href="tel:1799" className="inline-flex min-h-11 items-center underline">ScamShield 1799</a>
            <a href="tel:999" className="inline-flex min-h-11 items-center underline">Police emergency 999</a>
          </div>
        </section>

        <div className="mt-10 rounded-2xl bg-harbor-sage-tint p-6 text-center">
          <p className="leading-7">GuideBuoy summarises and organises. Official sources remain authoritative.</p>
          <Button asChild className="mt-5"><Link href="/">Start your free report</Link></Button>
        </div>
      </MarketingSection>
    </MarketingPage>
  )
}
