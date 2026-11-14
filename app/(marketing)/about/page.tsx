import type { Metadata } from 'next'
import { pageAlternates } from '@/lib/seo/indexing'
import { Building2, Compass, Eye, Scale } from 'lucide-react'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { ContactCard } from '@/components/harbor/contact-disclosure'
import { WhatGuideBuoyIs } from '@/components/harbor/what-guidebuoy-is'

export const metadata: Metadata = {
  title: { absolute: 'About GuideBuoy AI SG Pte Ltd: who we are and why we built it' },
  description: 'A Singapore company helping people who represent themselves prepare scam and financial disputes.',
  alternates: pageAlternates('/about'),
}

const principles = [
  { icon: Building2, title: 'Singapore company', text: 'GuideBuoy AI SG Pte Ltd, UEN 202545875C, operates GuideBuoy AI.' },
  { icon: Eye, title: 'Review before acting', text: 'GuideBuoy is automated. You check everything before you send it.' },
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
          <h2 className="text-[1.75rem] leading-tight font-semibold sm:text-[2rem] text-harbor-deep">Tell us once.</h2>
          <p className="mt-4 leading-8 text-muted-foreground">GuideBuoy turns what happened to you into one clear, checked record, and shows you the right next step, whether that&apos;s your bank, the police or FIDReC. You stay in control of every fact and every document you share.</p>
        </div>
      </MarketingSection>

      <section className="border-y bg-card py-12 sm:py-16" aria-labelledby="principles-title">
        <div className="gb-container">
          <h2 id="principles-title" className="text-[1.75rem] leading-tight font-semibold sm:text-[2rem] text-harbor-deep">What we are — and what we are not</h2>
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
        <h2 className="text-[1.75rem] leading-tight font-semibold sm:text-[2rem] text-harbor-deep">Responsible use</h2>
        <p className="mt-4 max-w-3xl leading-8 text-muted-foreground">
          GuideBuoy structures information for review. Your case information may indicate a next step. Check the official requirements before acting.
        </p>
        <WhatGuideBuoyIs className="mt-9" />
        <div className="mt-10"><ContactCard /></div>
      </MarketingSection>
    </MarketingPage>
  )
}
