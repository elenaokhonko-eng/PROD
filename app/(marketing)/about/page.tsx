import type { Metadata } from 'next'
import { Building2, Compass, Eye, Scale } from 'lucide-react'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { ContactCard } from '@/components/harbor/contact-disclosure'

export const metadata: Metadata = {
  title: 'About',
  description: "Why GuideBuoy AI is building Singapore's calm complaint helper and how Lumi supports — rather than decides — your case.",
  alternates: { canonical: '/about' },
}

const principles = [
  { icon: Building2, title: 'Singapore company', text: 'GuideBuoy AI SG Pte Ltd, UEN 202545875C, operates GuideBuoy AI.' },
  { icon: Eye, title: 'Review before acting', text: 'Generated automatically by GuideBuoy AI. It has not been reviewed by a person.' },
  { icon: Scale, title: 'Not legal advice', text: 'GuideBuoy helps organise information. It does not decide your case or provide legal advice.' },
] as const

export default function AboutPage() {
  return (
    <MarketingPage
      eyebrow="Why GuideBuoy exists"
      title="The burden should sit on the system, not the person who was harmed."
      intro="After a scam, people are expected to retell a difficult story in formal language across different forms, deadlines and organisations. GuideBuoy helps carry that administrative load."
    >
      <MarketingSection className="grid items-center gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="gb-card flex min-h-72 items-center justify-center bg-harbor-teal-tint p-8">
          <Compass className="size-28 text-primary" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-3xl font-semibold text-harbor-deep">A steady light, not a promise</h2>
          <p className="mt-4 leading-8 text-muted-foreground">A buoy does not pull you out of the water. It holds its position, keeps its light on and shows the way in. Lumi helps organise one clear record so you can decide where to take it next.</p>
          <p className="mt-4 leading-8 text-muted-foreground">You see the organised facts, correct anything that is wrong and choose what to share.</p>
        </div>
      </MarketingSection>

      <section className="border-y bg-card py-12 sm:py-16" aria-labelledby="principles-title">
        <div className="gb-container">
          <h2 id="principles-title" className="text-3xl font-semibold text-harbor-deep">What we are — and what we are not</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {principles.map(({ icon: Icon, title, text }) => (
              <article key={title} className="rounded-2xl border bg-background p-6">
                <Icon className="size-7 text-primary" aria-hidden="true" />
                <h3 className="mt-4 text-xl font-semibold">{title}</h3>
                <p className="mt-2 leading-7 text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <MarketingSection>
        <h2 className="text-3xl font-semibold text-harbor-deep">Responsible use</h2>
        <p className="mt-4 max-w-3xl leading-8 text-muted-foreground">
          GuideBuoy structures information for review. Human consultation is separate and is not currently available.
          Your case information may indicate a next step. Check the official requirements before acting.
        </p>
        <div className="mt-10"><ContactCard /></div>
      </MarketingSection>
    </MarketingPage>
  )
}
