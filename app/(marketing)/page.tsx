import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, FileCheck2, LockKeyhole, Repeat2 } from 'lucide-react'
import { NarrativeCapture } from '@/components/landing/narrative-capture'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: "Singapore's Complaint Helper",
  description: 'Tell your story once. Lumi helps organise the facts, evidence and next steps for a complaint.',
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
    title: 'Start organising for free.',
    text: 'Tell your story, add supporting material, and receive a draft when your case is ready.',
  },
  {
    icon: LockKeyhole,
    title: 'You stay in control.',
    text: 'Review the information Lumi organises and decide whether you want to continue at each step.',
  },
] as const

export default function HomePage() {
  return (
    <main id="main-content" tabIndex={-1} className="flex-1">
      <section className="hero-gradient border-b py-10 sm:py-16">
        <div className="gb-container grid items-center gap-10 lg:grid-cols-[1fr_0.86fr]">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">GuideBuoy AI</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-harbor-deep sm:text-5xl lg:text-6xl">
              Tell it once. We&apos;ll help you carry it from here.
            </h1>
            <p className="mt-6 text-lg leading-8 text-muted-foreground">
              If you&apos;ve been scammed or you&apos;re stuck in a dispute with a bank, telco or platform — you&apos;re in the right place, and it&apos;s not your fault. Take your time. Lumi helps turn what happened into one clear, organised record.
            </p>
            <p className="mt-4 text-sm font-medium">Not legal advice — a calm, structured way to get your facts in order.</p>
            <Button asChild variant="link" className="mt-4 h-auto min-h-11 whitespace-normal px-0 text-left">
              <Link href="/router">
                Not sure where to start? Check my complaint path <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <div className="gb-illo mx-auto max-w-sm">
            <Image
              src="/assets/harbor/lumi-buoy.jpg"
              alt="Lumi, the GuideBuoy buoy guide"
              width={640}
              height={640}
              priority
              className="gb-decorative aspect-square rounded-[2rem] object-cover shadow-harbor"
            />
          </div>
        </div>
      </section>

      <section className="gb-container -mt-1 py-10 sm:py-14">
        <div id="tell-your-story" className="mx-auto max-w-3xl scroll-mt-24">
          <NarrativeCapture />
        </div>
      </section>

      <section className="border-y bg-card py-12 sm:py-16" aria-labelledby="reasons-title">
        <div className="gb-container">
          <h2 id="reasons-title" className="text-center text-3xl font-semibold text-harbor-deep">
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
        <h2 id="journey-title" className="text-3xl font-semibold text-harbor-deep">The journey in one glance</h2>
        <p className="mx-auto mt-5 max-w-4xl text-lg leading-8 text-muted-foreground">
          Tell your story → Add supporting material → Answer focused questions → Review your free draft → Choose your next step → See further options where offered.
        </p>
        <Button asChild variant="outline" className="mt-7">
          <Link href="/how-it-works">See exactly how it works <ArrowRight aria-hidden="true" /></Link>
        </Button>
      </section>
    </main>
  )
}
