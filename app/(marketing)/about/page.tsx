import type { Metadata } from 'next'
import { pageAlternates, pagePreview } from '@/lib/seo/indexing'
import Image from 'next/image'
import { Building2, Eye, Scale } from 'lucide-react'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { ContactCard } from '@/components/harbor/contact-disclosure'
import { StartEvaluationButton } from '@/components/harbor/start-evaluation-button'
import { UenCheck } from '@/components/harbor/trust-row'
import { WhatGuideBuoyIs } from '@/components/harbor/what-guidebuoy-is'
import { JsonLd } from '@/components/seo/json-ld'
import { FOUNDER, FOUNDER_NOTE, PENDING_LABEL, teamGroup } from '@/lib/content/team'
import { cn } from '@/lib/utils'
import { COMPANY } from '@/lib/harbor/company'
import { founderJsonLd } from '@/lib/seo/structured-data'

export const metadata: Metadata = {
  title: { absolute: 'About GuideBuoy AI SG Pte Ltd: who we are and why we built it' },
  description: 'A Singapore company helping people who represent themselves prepare scam and financial disputes.',
  alternates: pageAlternates('/about'),
  ...pagePreview('/about', 'About GuideBuoy AI SG Pte Ltd: who we are and why we built it', 'A Singapore company helping people who represent themselves prepare scam and financial disputes.'),
}

const principles = [
  { icon: Building2, title: 'Singapore company', text: 'GuideBuoy AI SG Pte Ltd, UEN 202545875C, operates GuideBuoy AI.' },
  { icon: Eye, title: 'Review before acting', text: 'GuideBuoy is automated. You check everything before you send it.' },
  { icon: Scale, title: 'Not legal advice', text: 'GuideBuoy helps organise information. It does not decide your case or provide legal advice.' },
] as const

const GROUPS = [
  { group: 'team', title: 'Team' },
  { group: 'adviser', title: 'Advisers' },
] as const

export default function AboutPage() {
  return (
    <MarketingPage
      eyebrow="Why GuideBuoy exists"
      title="The burden should sit on the system, not the person who was harmed."
      intro="After a scam, people are expected to retell a difficult story in formal language across different forms, deadlines and organisations. GuideBuoy helps carry that administrative load."
    >
      <JsonLd data={founderJsonLd()} />
      <MarketingSection className="grid items-start gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Brief W1 §G: the founder note, word for word. */}
        {FOUNDER ? (
          <figure className="gb-card bg-harbor-teal-tint p-6 sm:p-8" aria-labelledby="founder-note-title">
            <div className="flex items-center gap-4">
              <Image src={FOUNDER.photo} alt={FOUNDER.name} width={96} height={96} className="size-24 shrink-0 rounded-full object-cover" />
              <h2 id="founder-note-title" className="text-xl font-semibold text-harbor-deep">Why GuideBuoy exists.</h2>
            </div>
            <blockquote className="mt-4 text-lg leading-8 text-foreground">{FOUNDER_NOTE}</blockquote>
            <figcaption className="mt-4 leading-7">
              {/* The brief's sign-off, word for word; the full title is on her team card below. */}
              — {FOUNDER.name}, founder
              {' · '}
              <a href={FOUNDER.linkedin} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                LinkedIn<span className="sr-only"> profile of {FOUNDER.name} (opens in a new tab)</span>
              </a>
            </figcaption>
          </figure>
        ) : null}
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

      {/* Brief W1 §G: the team and advisers from lib/content/team.ts, in Elena's order. A pending card is greyed out,
          labelled and has no LinkedIn link (Elena, 19 Nov). */}
      <MarketingSection>
        {GROUPS.map(({ group, title }) => (
          <section key={group} aria-labelledby={`${group}-title`} className="mt-10 first:mt-0">
            <h2 id={`${group}-title`} className="text-[1.75rem] leading-tight font-semibold sm:text-[2rem] text-harbor-deep">{title}</h2>
            <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {teamGroup(group).map((member) => {
                const pending = member.status === 'pending'
                return (
                  <li key={member.name} data-status={member.status} className={cn('flex flex-col rounded-card border bg-card p-6', pending && 'border-dashed')}>
                    <Image
                      src={member.photo}
                      alt={member.name}
                      width={80}
                      height={80}
                      className={cn('size-20 rounded-full object-cover', pending && 'opacity-60 grayscale')}
                    />
                    {pending ? (
                      <p className="mt-4 w-fit rounded-full bg-harbor-surface-subtle px-3 py-1 text-sm font-medium text-foreground">{PENDING_LABEL}</p>
                    ) : null}
                    <h3 className={cn('mt-4 text-xl font-semibold', pending && 'text-muted-foreground')}>{member.name}</h3>
                    <p className="text-muted-foreground">{member.title}</p>
                    <p className={cn('mt-3 leading-7', pending && 'text-muted-foreground')}>{member.line}</p>
                    {pending ? null : (
                      <a href={member.linkedin} target="_blank" rel="noopener noreferrer" className="mt-auto inline-flex min-h-11 items-center pt-3 font-medium underline">
                        LinkedIn<span className="sr-only"> profile of {member.name} (opens in a new tab)</span>
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </MarketingSection>

      {/* Brief W1 §G: about checking the company, with the same BizFile link and Copy UEN as the trust row. */}
      <MarketingSection className="pb-0 sm:pb-0">
        <section className="rounded-card border bg-harbor-surface-subtle p-6" aria-labelledby="company-title">
          <h2 id="company-title" className="text-xl font-semibold text-harbor-deep">Check this company</h2>
          <p className="mt-3 leading-7">
            {COMPANY.legalName} · UEN {COMPANY.uen} · {COMPANY.address.display}
          </p>
          <p className="mt-1 leading-7"><UenCheck /></p>
        </section>
      </MarketingSection>

      <MarketingSection>
        <h2 className="text-[1.75rem] leading-tight font-semibold sm:text-[2rem] text-harbor-deep">Responsible use</h2>
        <p className="mt-4 max-w-3xl leading-8 text-muted-foreground">
          GuideBuoy structures information for review. Your case information may indicate a next step. Check the official requirements before acting.
        </p>
        <WhatGuideBuoyIs className="mt-9" />
        <div className="mt-10"><ContactCard /></div>
        {/* Brief W1 §G: the primary button at the end. */}
        <div className="mt-10 flex justify-center"><StartEvaluationButton /></div>
      </MarketingSection>
    </MarketingPage>
  )
}
