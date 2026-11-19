import type { Metadata } from 'next'
import { pageAlternates, pagePreview } from '@/lib/seo/indexing'
import Image from 'next/image'
import { ExternalLink, HeartHandshake, Scale, UsersRound } from 'lucide-react'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { Button } from '@/components/ui/button'
import { MARKETPLACE_INTRO, PARTNERS, PENDING_LABEL } from '@/lib/content/partners'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Future help categories',
  description: 'See the help categories GuideBuoy may support in future. These services are not currently available through GuideBuoy.',
  alternates: pageAlternates('/marketplace'),
  ...pagePreview('/marketplace', 'Future help categories · GuideBuoy', 'See the help categories GuideBuoy may support in future. These services are not currently available through GuideBuoy.'),
}

const supportTypes = [
  { icon: Scale, title: 'Legal clinics' },
  { icon: HeartHandshake, title: 'Social-service referrals' },
  { icon: UsersRound, title: 'Human consultation and warm handovers' },
] as const

export default function MarketplacePage() {
  return (
    <MarketingPage
      eyebrow="Future help directory"
      title="Help categories being considered."
      intro={MARKETPLACE_INTRO}
    >
      <MarketingSection>
        <div className="rounded-card border bg-harbor-sage-tint p-4 sm:p-6">
          <h2 className="text-2xl font-semibold text-harbor-primary-active">Not currently available</h2>
          <p className="mt-3 gb-readable leading-7 text-muted-foreground">
            GuideBuoy does not currently provide a help directory, booking service or warm handover.
          </p>
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {supportTypes.map(({ icon: Icon, title }) => (
            <article key={title} className="gb-card p-4 sm:p-6">
              <Icon className="size-7 text-primary" aria-hidden="true" />
              <h2 className="mt-4 text-xl font-semibold">{title}</h2>
              <p className="mt-2 leading-7 text-foreground">Planned—not currently available through GuideBuoy.</p>
              <Button type="button" variant="outline" className="mt-5 w-full text-base" disabled aria-describedby={`${title.replaceAll(' ', '-').toLowerCase()}-reason`}>
                View help resources
              </Button>
              <p id={`${title.replaceAll(' ', '-').toLowerCase()}-reason`} className="mt-2 text-sm text-muted-foreground">
                This action will be enabled only after the service is available.
              </p>
            </article>
          ))}
        </div>
        {/* Brief W1 §I: no consultation card here; it contradicted "Not currently available" above. */}
        {/* Elena, 19 Nov: the first legal partner, greyed out and labelled until the arrangement is confirmed. */}
        {PARTNERS.map((partner) => {
          const pending = partner.status === 'pending'
          return (
            <article
              key={partner.id}
              id={partner.id}
              data-status={partner.status}
              aria-labelledby={`${partner.id}-title`}
              className={cn('mt-8 rounded-card border bg-card p-4 sm:p-6', pending && 'border-dashed')}
            >
              <h2 id={`${partner.id}-title`} className="text-xl font-semibold text-harbor-deep">{partner.heading}</h2>
              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
                <Image
                  src={partner.photo}
                  alt={partner.person}
                  width={80}
                  height={80}
                  className={cn('size-20 shrink-0 rounded-full object-cover', pending && 'opacity-60 grayscale')}
                />
                <div>
                  {pending ? (
                    <p className="w-fit rounded-full bg-harbor-surface-subtle px-3 py-1 text-sm font-medium text-foreground">{PENDING_LABEL}</p>
                  ) : null}
                  <h3 className="mt-2 text-lg font-semibold">{partner.person}</h3>
                  <p className="text-muted-foreground">{partner.title}</p>
                  <p className="mt-3 gb-readable leading-7">{partner.line}</p>
                  <a
                    href={partner.website.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex min-h-11 items-center gap-2 font-medium underline underline-offset-4"
                  >
                    {partner.website.label}
                    <ExternalLink className="size-4" aria-hidden="true" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </div>
              </div>
            </article>
          )
        })}
      </MarketingSection>
    </MarketingPage>
  )
}
