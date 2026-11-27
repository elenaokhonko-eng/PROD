import Link from 'next/link'
import { SAMPLE_PATH } from '@/lib/samples/paths'
import { paidStagesState } from '@/lib/billing/paid-stages'
import { Button } from '@/components/ui/button'
import { COMING_SHORTLY, COMPARISON_LINE, FIDREC_ABOUT, FIDREC_TIME_LIMIT, packCards } from '@/lib/harbor/packs'
import { cn } from '@/lib/utils'

// Three separate options (spec section 6), not a sequence. Brief W1 §E1–E3 and Addendum V §V3, V7: the comparison
// line above the cards; the same four parts on every card; the free card tinted and marked "Start here"; equal-height
// cards with the button at the bottom; one border per card. Until the packs go live the paid cards end with the
// "Coming shortly" badge and have no button.
export function PackComparison({ headingLevel = 'h2' }: { headingLevel?: 'h2' | 'h3' }) {
  const { enabled: live } = paidStagesState()
  const Heading = headingLevel
  return (
    <div className="flex flex-col gap-8">
      <p className="mx-auto max-w-[65ch] text-center text-lg leading-8 text-foreground">{COMPARISON_LINE}</p>
      <div className="grid gap-5 lg:grid-cols-3">
        {packCards(live).map((card) => (
          <article
            key={card.id}
            id={card.id}
            aria-labelledby={`${card.id}-title`}
            className={cn('flex scroll-mt-24 flex-col rounded-card border p-6', card.paid ? 'bg-card' : 'bg-harbor-teal-tint')}
          >
            {card.paid ? null : (
              <p className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-harbor-deep">Start here</p>
            )}
            <Heading id={`${card.id}-title`} className="text-2xl font-semibold text-harbor-deep">
              {card.name}
            </Heading>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-3xl font-semibold">{card.price}</p>
              {card.paid && !live ? (
                <span className="rounded-full bg-harbor-warning-tint px-3 py-1 text-sm font-semibold text-foreground">
                  {COMING_SHORTLY}
                </span>
              ) : null}
            </div>
            <div className="mt-5 flex flex-col gap-3 text-base leading-7 text-foreground">
              <p><strong className="font-semibold">For you if</strong> {card.forYouIf}.</p>
              <p><strong className="font-semibold">You get</strong> {card.youGet}.</p>
              <p><strong className="font-semibold">Good to know:</strong> {card.goodToKnow}.</p>
            </div>
            {card.paid === 'fidrec' ? (
              <details className="mt-4">
                <summary className="flex min-h-11 cursor-pointer items-center font-medium text-harbor-deep">What is FIDReC?</summary>
                <p className="mt-1 leading-7 text-foreground">{FIDREC_ABOUT} {FIDREC_TIME_LIMIT}</p>
              </details>
            ) : null}
            {/* Brief W1 §E2, §H: "See a sample" on the card whose sample exists (the free evaluation, for now). */}
            {card.paid ? null : (
              <Link href={SAMPLE_PATH} className="mt-4 inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">
                See a sample
              </Link>
            )}
            {card.action ? (
              <div className="mt-auto pt-7">
                {/* PB-16 (Elena, 25 Nov): a pack's button appears only when the packs are live, and then every button
                    is filled, to show it works. */}
                <Button asChild variant="default" className="w-full text-base font-semibold">
                  <Link href={card.action.href}>{card.action.label}</Link>
                </Button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  )
}
