import Link from 'next/link'

export function PublicFooter() {
  return (
    <footer className="mt-auto border-t bg-card" aria-labelledby="footer-heading">
      <div className="gb-container grid gap-8 py-10 md:grid-cols-[1.3fr_1fr]">
        <div className="space-y-2 text-sm leading-6 text-muted-foreground">
          <h2 id="footer-heading" className="font-semibold text-foreground">
            GuideBuoy AI SG Pte Ltd
          </h2>
          <p>UEN 202545875C</p>
          <p>51 Goldhill Plaza #07-10/11, Singapore 308900</p>
          <p>DID +65 9072 7915 · Main +65 6690 9262</p>
        </div>
        <div className="space-y-5 md:text-right">
          <nav aria-label="Legal and support" className="flex flex-wrap gap-x-5 gap-y-2 text-sm md:justify-end">
            <Link href="/terms" className="min-h-11 py-3 underline-offset-4 hover:underline">
              Terms
            </Link>
            <Link href="/privacy" className="min-h-11 py-3 underline-offset-4 hover:underline">
              Privacy
            </Link>
            <a href="mailto:security@guidebuoyai.sg" className="min-h-11 py-3 underline-offset-4 hover:underline">
              Report a vulnerability
            </a>
          </nav>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm md:justify-end">
            <a
              href="https://wa.me/6590727915"
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-11 py-3 font-medium text-primary underline-offset-4 hover:underline"
            >
              WhatsApp
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <a href="mailto:hello@guidebuoyai.sg" className="min-h-11 py-3 underline-offset-4 hover:underline">
              Email us
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
