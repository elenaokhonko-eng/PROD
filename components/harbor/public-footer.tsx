import Link from 'next/link'
import { COMPANY } from '@/lib/harbor/company'
import { SAFETY_NOTICE } from '@/lib/safety-notice'

// Signed-in case pages leave out WhatsApp: human support there is not approved (slice 7).
// Brief W1 §K renames the public line only; in-app screens keep their wording under W1.
export function PublicFooter({ whatsApp = true }: { whatsApp?: boolean }) {
  return (
    <footer className="mt-auto border-t bg-card" aria-labelledby="footer-heading">
      <div className="gb-container grid gap-8 py-10 md:grid-cols-[1.3fr_1fr]">
        <div className="space-y-2 text-sm leading-6 text-muted-foreground">
          <h2 id="footer-heading" className="font-semibold text-foreground">
            {COMPANY.legalName}
          </h2>
          <p>UEN {COMPANY.uen}</p>
          <p>{COMPANY.address.display}</p>
          <p>{whatsApp ? 'Mobile / WhatsApp' : 'DID'} {COMPANY.mobile.display} · Main {COMPANY.main.display}</p>
          <p className="font-medium text-foreground">{SAFETY_NOTICE}</p>
        </div>
        <div className="space-y-5 md:text-right">
          <nav aria-label="Legal and support" className="flex flex-wrap gap-x-5 gap-y-2 text-sm md:justify-end">
            <Link href="/terms" className="min-h-11 py-3 underline-offset-4 hover:underline">
              Terms
            </Link>
            <Link href="/privacy" className="min-h-11 py-3 underline-offset-4 hover:underline">
              Privacy
            </Link>
          </nav>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm md:justify-end">
            {whatsApp ? (
              <a
                href="https://wa.me/6590727915"
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-11 py-3 font-medium text-primary underline-offset-4 hover:underline"
              >
                WhatsApp
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
            <a href="mailto:info@guidebuoyai.sg" className="min-h-11 py-3 underline-offset-4 hover:underline">
              Email us
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
