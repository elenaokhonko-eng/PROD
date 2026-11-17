import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { paidStagesState } from '@/lib/billing/paid-stages'
import { routeStops } from '@/lib/harbor/packs'
import { cn } from '@/lib/utils'

// Brief W1 §D2 drawn as Addendum V §V6: four numbered marks joined by a line (across on desktop, down on phones), on the
// teal tint. An ordered list, so screen readers hear the stops in order; information, not a selector, so no state.
export function RouteStrip({ className }: { className?: string }) {
  const { enabled: live } = paidStagesState()
  return (
    <section aria-labelledby="route-title" className={cn('bg-harbor-teal-tint py-10 sm:py-14', className)}>
      <div className="gb-container">
        <h2 id="route-title" className="text-center text-[1.75rem] leading-tight font-semibold text-harbor-deep sm:text-[2rem]">
          Where are you now?
        </h2>
        <ol className="mt-8 grid gap-6 lg:grid-cols-4 lg:gap-5" data-testid="route-strip">
          {routeStops(live).map((stop, index) => (
            <li
              key={stop.title}
              className={cn(
                'relative flex gap-4 lg:flex-col lg:gap-3',
                // The joining line: from this mark to the next one, down on phones and across on desktop.
                'before:absolute before:top-10 before:-bottom-6 before:left-5 before:w-0.5 before:bg-primary/40',
                'lg:before:top-5 lg:before:right-[-1.25rem] lg:before:bottom-auto lg:before:left-10 lg:before:h-0.5 lg:before:w-auto',
                'last:before:hidden',
              )}
            >
              <span
                aria-hidden="true"
                className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground"
              >
                {index + 1}
              </span>
              <div className="flex-1 rounded-card border bg-card p-4">
                <h3 className="text-lg font-semibold text-harbor-deep">{stop.title}</h3>
                <p className="mt-1 text-base leading-7 text-foreground">{stop.line}</p>
                {stop.helper ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{stop.helper}</p> : null}
                <p className="mt-2 flex flex-wrap gap-x-4">
                  {stop.links.map((link) => (
                    <Link key={link.label} href={link.href} className="inline-flex min-h-11 items-center font-medium text-primary underline">
                      {link.label}
                    </Link>
                  ))}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex justify-center">
          <Button asChild variant="outline">
            <Link href="/how-it-works">See exactly how it works <ArrowRight aria-hidden="true" /></Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
