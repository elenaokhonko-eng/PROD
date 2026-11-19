import type { Metadata } from 'next'
import { pageAlternates, pagePreview } from '@/lib/seo/indexing'
import { ExternalLink, PhoneCall, Siren } from 'lucide-react'
import { MarketingPage, MarketingSection } from '@/components/harbor/marketing-page'
import { StartEvaluationButton } from '@/components/harbor/start-evaluation-button'
import { BANK_HOTLINES, LAST_CHECKED, OFFICIAL_SOURCES } from '@/lib/resources/official-help'

const sectionTitle = 'text-[1.75rem] leading-tight font-semibold sm:text-[2rem] text-harbor-deep'

// "2026-11-18" → "18 Nov 2026", the site's one date format.
function formatChecked(isoDate: string) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export const metadata: Metadata = {
  title: { absolute: 'Scam just happened? Who to call in Singapore · GuideBuoy' },
  description: 'Bank fraud hotlines, ScamShield, police reporting and official guidance, in the order to use them.',
  alternates: pageAlternates('/resources'),
  ...pagePreview('/resources', 'Scam just happened? Who to call in Singapore · GuideBuoy', 'Bank fraud hotlines, ScamShield, police reporting and official guidance, in the order to use them.'),
}

export default function ResourcesPage() {
  return (
    <MarketingPage
      eyebrow="Official Singapore help"
      title="Scam just happened? Call your bank first."
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

        <p className="mt-10 max-w-3xl leading-7 text-muted-foreground">
          Links open websites operated by the named organisations. GuideBuoy is not affiliated with or endorsed by them.
        </p>

        {/* Brief W1 §I: server-rendered, in the brief's order, every number from the organisation's own website. */}
        <section className="mt-8" aria-labelledby="banks-title">
          <h2 id="banks-title" className={sectionTitle}>Bank fraud hotlines</h2>
          <p className="mt-3 max-w-3xl leading-7">Call your bank&apos;s fraud hotline and ask them to freeze your accounts and cards.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Numbers taken from each bank&apos;s own website. Last checked <time dateTime={LAST_CHECKED}>{formatChecked(LAST_CHECKED)}</time>.
          </p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="bank-hotlines">
            {BANK_HOTLINES.map((line) => (
              <li key={line.bank} className="flex flex-col rounded-card border bg-card p-5">
                <h3 className="font-semibold text-harbor-deep">{line.bank}</h3>
                <a href={`tel:${line.tel}`} className="mt-1 inline-flex min-h-11 items-center gap-2 text-lg font-semibold text-primary underline underline-offset-4">
                  <PhoneCall className="size-4" aria-hidden="true" />
                  {line.phone}
                </a>
                <p className="leading-7 text-muted-foreground">{line.label}</p>
                <a href={line.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-auto inline-flex min-h-11 items-center pt-2 text-sm underline underline-offset-4">
                  Source: {line.bank} website<span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        {OFFICIAL_SOURCES.map((source) => (
          <section key={source.id} id={source.id} className="mt-10 scroll-mt-24" aria-labelledby={`${source.id}-title`}>
            <h2 id={`${source.id}-title`} className={sectionTitle}>{source.title}</h2>
            <p className="mt-3 max-w-3xl leading-7">{source.line}</p>
            <div className="mt-3 flex flex-wrap gap-x-6">
              {source.phone ? (
                <a href={`tel:${source.phone.tel}`} className="inline-flex min-h-11 items-center gap-2 font-semibold text-primary underline underline-offset-4">
                  <PhoneCall className="size-4" aria-hidden="true" />
                  {source.phone.display}
                </a>
              ) : null}
              <a href={source.link.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 font-medium underline underline-offset-4">
                {source.link.label}
                <ExternalLink className="size-4" aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          </section>
        ))}

        <div className="mt-10 rounded-2xl bg-harbor-sage-tint p-6 text-center">
          <p className="leading-7">GuideBuoy summarises and organises. Official sources remain authoritative.</p>
          <StartEvaluationButton className="mt-5" />
        </div>
      </MarketingSection>
    </MarketingPage>
  )
}
