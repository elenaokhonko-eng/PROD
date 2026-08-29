import type { Metadata } from 'next'
import { HeartHandshake, Scale, UsersRound } from 'lucide-react'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'Future help categories',
  description: 'See the help categories GuideBuoy may support in future. These services are not currently available through GuideBuoy.',
  alternates: { canonical: '/marketplace' },
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
      intro="These cards describe possible categories only. They are not referrals, partnerships or available services."
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
              <p className="mt-2 leading-7 text-muted-foreground">Planned—not currently available through GuideBuoy.</p>
              <Button type="button" variant="outline" className="mt-5 w-full" disabled aria-describedby={`${title.replaceAll(' ', '-').toLowerCase()}-reason`}>
                View help resources
              </Button>
              <p id={`${title.replaceAll(' ', '-').toLowerCase()}-reason`} className="mt-2 text-sm text-muted-foreground">
                This action will be enabled only after the service is available.
              </p>
            </article>
          ))}
        </div>
        <aside className="mt-8 rounded-card border bg-harbor-surface-subtle p-4 sm:p-6" aria-label="Human consultation availability">
          <h2 className="text-xl font-semibold">Consultation</h2>
          <p className="mt-2 leading-7 text-muted-foreground">Human consultation is not currently available.</p>
        </aside>
      </MarketingSection>
    </MarketingPage>
  )
}
