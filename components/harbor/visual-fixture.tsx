import Image from 'next/image'
import Link from 'next/link'
import { AlertCircle, CheckCircle2, CircleDashed, Clock3, Info, LockKeyhole } from 'lucide-react'
import { ModeSwitcher } from '@/components/harbor/mode-switcher'
import { Button } from '@/components/ui/button'
import { HARBOR_VISUAL_FIXTURES, type HarborFixtureTone, type HarborVisualFixture } from '@/lib/harbor/visual-fixtures'
import { cn } from '@/lib/utils'

const toneStyles: Record<HarborFixtureTone, string> = {
  neutral: 'border-harbor-info/35 bg-harbor-teal-tint',
  progress: 'border-harbor-empathy/40 bg-harbor-lavender-tint',
  success: 'border-harbor-success/40 bg-harbor-success-tint',
  warning: 'border-harbor-warning/45 bg-harbor-warning-tint',
  error: 'border-harbor-danger/40 bg-harbor-error-tint',
  inactive: 'border-border bg-muted',
}

const toneIcons = {
  neutral: Info,
  progress: Clock3,
  success: CheckCircle2,
  warning: AlertCircle,
  error: AlertCircle,
  inactive: LockKeyhole,
} satisfies Record<HarborFixtureTone, typeof Info>

export function HarborVisualFixture({ fixture }: { fixture: HarborVisualFixture }) {
  const ToneIcon = toneIcons[fixture.tone]
  const familyFixtures = HARBOR_VISUAL_FIXTURES.filter((item) => item.family === fixture.family)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="gb-container flex min-h-16 items-center gap-3">
          <Image src="/assets/harbor/lumi-buoy.jpg" alt="" width={40} height={40} className="size-10 rounded-full object-cover" priority />
          <div className="min-w-0">
            <p className="truncate font-semibold text-harbor-deep">GuideBuoy AI</p>
            <p className="truncate text-xs text-muted-foreground">Harbor visual acceptance fixture</p>
          </div>
          <div className="ml-auto"><ModeSwitcher /></div>
        </div>
      </header>

      <main id="main-content" className="gb-container py-8 sm:py-12">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-harbor-sage">Family {fixture.family}</p>
          <h1 className="mt-2 text-3xl font-semibold text-harbor-deep sm:text-4xl">{fixture.title}</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Synthetic visual fixture — no account, case, payment or production data is used.</p>

          <section
            data-testid="fixture-card"
            aria-labelledby="fixture-state-title"
            className="mt-8 overflow-hidden rounded-dialog border bg-card shadow-harbor"
          >
            <div className={cn('flex items-start gap-3 border-b p-5 sm:p-6', toneStyles[fixture.tone])} role={fixture.tone === 'error' ? 'alert' : 'status'}>
              <ToneIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em]">{fixture.id}</p>
                <h2 id="fixture-state-title" className="mt-1 text-xl font-semibold">{fixture.title}</h2>
                <p className="mt-2 leading-7">{fixture.summary}</p>
              </div>
            </div>

            <div className="space-y-6 p-5 sm:p-7">
              {fixture.tone === 'progress' ? (
                <div aria-label="Current stage" className="grid gap-3 sm:grid-cols-3">
                  {['Received', 'Current stage', 'Next status'].map((label, index) => (
                    <div key={label} className={cn('flex min-h-16 items-center gap-2 rounded-control border px-3 text-sm', index === 1 && 'border-primary bg-harbor-teal-tint font-semibold')}>
                      <CircleDashed className={cn('size-4 shrink-0', index === 1 && 'animate-spin')} aria-hidden="true" />
                      {label}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-control border bg-background p-4">
                    <p className="text-sm font-semibold">What is retained</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">Only the synthetic state shown on this page.</p>
                  </div>
                  <div className="rounded-control border bg-background p-4">
                    <p className="text-sm font-semibold">Authority</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">Production handlers and server decisions remain unchanged.</p>
                  </div>
                </div>
              )}

              {fixture.automated && (
                <div className="rounded-control border border-harbor-info/35 bg-harbor-teal-tint p-4 text-sm leading-6">
                  Generated automatically by GuideBuoy AI. It has not been reviewed by a person.
                </div>
              )}

              <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center">
                <Button type="button" disabled>Fixture action unavailable</Button>
                <p className="text-sm leading-6 text-muted-foreground">Controls do not call APIs, change lifecycle state or grant access.</p>
              </div>
            </div>
          </section>

          <details className="mt-8 rounded-card border bg-card p-4">
            <summary className="min-h-11 cursor-pointer font-semibold">Browse Family {fixture.family} fixtures</summary>
            <nav aria-label={`Family ${fixture.family} visual fixtures`} className="mt-3 grid gap-2 sm:grid-cols-2">
              {familyFixtures.map((item) => (
                <Link
                  key={item.id}
                  href={`/harbor-fixtures?state=${encodeURIComponent(item.id)}`}
                  aria-current={item.id === fixture.id ? 'page' : undefined}
                  className={cn('min-h-11 rounded-control border px-3 py-2 text-sm hover:bg-accent', item.id === fixture.id && 'border-primary bg-harbor-teal-tint font-semibold')}
                >
                  {item.id}: {item.title}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </main>
    </div>
  )
}
