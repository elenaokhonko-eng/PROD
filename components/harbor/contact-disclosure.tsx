'use client'

import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function AccessibleDisclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-card border bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded-card px-4 py-3 font-semibold marker:content-none">
        {summary}
        <ChevronDown className="size-5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t px-4 py-4 leading-7 text-muted-foreground">{children}</div>
    </details>
  )
}

export function ContactCard() {
  return (
    <section className="rounded-card border bg-harbor-lavender-tint p-4 sm:p-6" aria-labelledby="contact-heading">
      <h2 id="contact-heading" className="text-2xl font-semibold text-harbor-deep">
        Still have questions?
      </h2>
      <p className="mt-2 max-w-2xl leading-7 text-muted-foreground">
        The contact form is not currently available. Please check back later for the verified request flow.
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button type="button" disabled aria-disabled="true" variant="outline" className="min-h-11 opacity-80">
          Contact form is not currently available.
        </Button>
      </div>
    </section>
  )
}
