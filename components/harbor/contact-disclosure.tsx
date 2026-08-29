import type { ReactNode } from 'react'
import { ChevronDown, Mail } from 'lucide-react'

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
        Contact the GuideBuoy team by email. Do not include passwords, card details or sensitive evidence in your message.
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <a
          href="mailto:hello@guidebuoyai.sg"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-primary px-5 py-2.5 font-medium text-primary-foreground"
        >
          <Mail className="size-4" aria-hidden="true" />
          Email GuideBuoy
        </a>
      </div>
    </section>
  )
}
