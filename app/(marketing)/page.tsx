import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, FileCheck2, LockKeyhole, Repeat2 } from 'lucide-react'
import { NarrativeCapture } from '@/components/landing/narrative-capture'
import { PackComparison } from '@/components/harbor/pack-comparison'
import { StartEvaluationButton } from '@/components/harbor/start-evaluation-button'
import { StickyStartBar } from '@/components/harbor/sticky-start-bar'
import { Button } from '@/components/ui/button'
import { paidStagesState } from '@/lib/billing/paid-stages'
import { NO_CARD_LINE } from '@/lib/harbor/cta'
import { PRODUCT_CATALOGUE } from '@/lib/payments/product-catalogue'
import { TrustRow } from '@/components/harbor/trust-row'
import { WhatGuideBuoyIs } from '@/components/harbor/what-guidebuoy-is'

export const metadata: Metadata = {
  title: { absolute: 'Scammed in Singapore? Free scam and bank dispute evaluation · GuideBuoy' },
  description: "Tell GuideBuoy what happened and get a free evaluation: your facts in order, how Singapore's scam rules may apply, and your next step with your bank or FIDReC.",
  alternates: { canonical: '/' },
}

const reasons = [
  {
    icon: Repeat2,
    title: 'Keep one organised record.',
    text: 'Bring your story and supporting material together before deciding which organisation to contact.',
  },
  {
    icon: FileCheck2,
    title: NO_CARD_LINE,
    text: 'Tell your story, add supporting material, and receive a draft when your case is ready.',
  },
  {
    icon: LockKeyhole,
    title: 'You stay in control.',
    text: 'Review the information GuideBuoy organises and decide whether you want to continue at each step.',
  },
] as const

// Brief W1 §A1: the second sub-line follows the paid-stages switch; prices come from the catalogue (copy ledger row 5).
function packLine(live: boolean) {
  const bank = PRODUCT_CATALOGUE.self_serve_report.amountSgd
  const fidrec = PRODUCT_CATALOGUE.fidrec_tier2_pack.amountSgd
  return live
    ? `When you’re ready: a complaint pack for your bank (S$${bank}) or a full case pack for FIDReC (S$${fidrec}).`
    : `Coming shortly: a complaint pack for your bank (S$${bank}) and a full case pack for FIDReC (S$${fidrec}).`
}

export default function HomePage() {
  const { enabled: packsLive } = paidStagesState()
  return (
    <main id="main-content" tabIndex={-1} className="flex-1">
      <section className="hero-gradient border-b py-10 sm:py-16">
        <div className="gb-container grid items-center gap-10 lg:grid-cols-[1fr_0.86fr]">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
              For scam and bank-dispute victims in Singapore
            </p>
            {/* Addendum V §V1: 36 px phone, 48 px tablet, 52 px desktop, line-height 1.1. */}
            <h1 className="mt-3 text-[2.25rem] leading-[1.1] font-semibold tracking-tight text-balance text-harbor-deep sm:text-5xl sm:leading-[1.1] lg:text-[3.25rem]">
              Scammed? Find out where you stand, and what to do next.
            </h1>
            <p className="mt-5 max-w-[65ch] text-lg leading-8 text-foreground lg:text-xl">
              Tell GuideBuoy what happened, once. You get a free evaluation: your facts in order, how Singapore&apos;s scam
              rules may apply to your case, and your next step.
            </p>
            <p className="mt-3 max-w-[65ch] text-base leading-7 text-foreground">{packLine(packsLive)}</p>
            <div className="mt-6 flex flex-col items-start gap-2">
              <StartEvaluationButton />
              <p className="text-sm text-muted-foreground">{NO_CARD_LINE}</p>
            </div>
          </div>
          {/* §A2: on phones the mascot no longer sits between the hero and the story box. */}
          <div className="gb-illo gb-avatar mx-auto hidden max-w-[16rem] lg:block">
            <Image
              src="/assets/harbor/lumi-buoy.jpg"
              alt="GuideBuoy’s avatar"
              width={640}
              height={640}
              priority
              className="gb-decorative aspect-square rounded-[2rem] object-cover"
            />
          </div>
        </div>
      </section>

      <section className="gb-container -mt-1 py-10 sm:py-14">
        <div id="tell-your-story" className="mx-auto flex max-w-3xl scroll-mt-24 flex-col gap-4">
          {/* Brief W1 §B1: the promises sit directly above the box where the visitor is asked to trust us. */}
          <TrustRow />
          <NarrativeCapture />
        </div>
      </section>

      <section className="gb-container py-10 sm:py-14" aria-labelledby="options-title">
        <h2 id="options-title" className="text-center text-[1.75rem] leading-tight font-semibold sm:text-[2rem] text-harbor-deep">
          Three ways we can help
        </h2>
        <div className="mt-9">
          <PackComparison headingLevel="h3" />
        </div>
        {/* Brief W1 §B3: once per page, after the product cards. */}
        <WhatGuideBuoyIs className="mt-9" />
      </section>

      <section className="border-y bg-card py-12 sm:py-16" aria-labelledby="reasons-title">
        <div className="gb-container">
          <h2 id="reasons-title" className="text-center text-[1.75rem] leading-tight font-semibold sm:text-[2rem] text-harbor-deep">
            A calmer way to move forward
          </h2>
          <div className="mt-9 grid gap-5 md:grid-cols-3">
            {reasons.map(({ icon: Icon, title, text }) => (
              <article key={title} className="rounded-card border bg-background p-4 sm:p-6">
                <Icon className="size-7 text-primary" aria-hidden="true" />
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-2 leading-7 text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="gb-container py-12 text-center sm:py-16" aria-labelledby="journey-title">
        <h2 id="journey-title" className="text-[1.75rem] leading-tight font-semibold sm:text-[2rem] text-harbor-deep">The journey in one glance</h2>
        <p className="mx-auto mt-5 max-w-4xl text-lg leading-8 text-muted-foreground">
          Tell your story → Add supporting material → Answer focused questions → Review your draft → Choose your next step → See further options where offered.
        </p>
        <Button asChild variant="outline" className="mt-7">
          <Link href="/how-it-works">See exactly how it works <ArrowRight aria-hidden="true" /></Link>
        </Button>
      </section>

      {/* §A4: closing band. */}
      <section className="border-t bg-card py-12 sm:py-16" aria-labelledby="closing-title">
        <div className="gb-container flex flex-col items-center gap-3 text-center">
          <h2 id="closing-title" className="text-[1.75rem] font-semibold text-harbor-deep sm:text-[2rem]">
            Find out where you stand
          </h2>
          <StartEvaluationButton className="mt-2" />
          <p className="text-sm text-muted-foreground">{NO_CARD_LINE}</p>
        </div>
      </section>
      <StickyStartBar />
    </main>
  )
}
