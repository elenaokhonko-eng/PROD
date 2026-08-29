import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type MarketingPageProps = {
  eyebrow?: string
  title: string
  intro: string
  children: ReactNode
  className?: string
}

export function MarketingPage({ eyebrow, title, intro, children, className }: MarketingPageProps) {
  return (
    <main id="main-content" tabIndex={-1} className={cn('flex-1', className)}>
      <section className="border-b bg-harbor-teal-tint py-14 sm:py-20">
        <div className="gb-container max-w-4xl text-center">
          {eyebrow && <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>}
          <h1 className="text-4xl font-semibold tracking-tight text-harbor-deep sm:text-5xl">{title}</h1>
          <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">{intro}</p>
        </div>
      </section>
      {children}
    </main>
  )
}

export function MarketingSection({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('gb-container py-12 sm:py-16', className)}>{children}</section>
}
